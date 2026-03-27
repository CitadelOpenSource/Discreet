// discreet_audit_export.rs — Audit log CSV and PDF export for platform admins.
//
// Endpoints:
//   GET /api/v1/admin/audit/export — Download audit log as CSV or PDF.
//
// Query parameters:
//   format  — "csv" (default) or "pdf".
//   start   — Optional ISO 8601 datetime filter (created_at >= start).
//   end     — Optional ISO 8601 datetime filter (created_at <= end).
//
// Rate limit: 1 export per 10 minutes per admin (Redis, fail-closed).

use std::sync::Arc;

use axum::{
    body::Body,
    extract::{Query, State},
    http::{header, HeaderValue, StatusCode},
    response::Response,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use uuid::Uuid;

use crate::discreet_error::AppError;
use crate::discreet_platform_admin_handlers::require_staff_role;
use crate::discreet_platform_permissions::PlatformUser;
use crate::discreet_state::AppState;

/// Rate limit: 1 export per 600 seconds (10 minutes).
const RATE_LIMIT_TTL: i64 = 600;

/// Maximum rows per export.
const MAX_ROWS: i64 = 10_000;

#[derive(Debug, Deserialize)]
pub struct AuditExportQuery {
    /// Output format: "csv" (default) or "pdf".
    pub format: Option<String>,
    /// ISO 8601 start datetime filter.
    pub start: Option<String>,
    /// ISO 8601 end datetime filter.
    pub end: Option<String>,
}

/// Row type for the audit export query.
#[derive(sqlx::FromRow)]
struct AuditRow {
    created_at: DateTime<Utc>,
    actor_username: Option<String>,
    action: String,
    target_type: Option<String>,
    target_id: Option<Uuid>,
    chain_hash: Option<String>,
}

// ─── GET /admin/audit/export ────────────────────────────────────────────

/// Export the platform-wide audit log as CSV or PDF.
/// Requires admin platform_role. Rate limited to 1 per 10 minutes.
pub async fn export_audit_log(
    caller: PlatformUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<AuditExportQuery>,
) -> Result<Response, AppError> {
    require_staff_role(&caller)?;

    // Validate format
    let fmt = params.format.as_deref().unwrap_or("csv");
    if fmt != "csv" && fmt != "pdf" {
        return Err(AppError::BadRequest(
            "format must be \"csv\" or \"pdf\"".into(),
        ));
    }

    // Parse date filters
    let start: Option<DateTime<Utc>> = match params.start {
        Some(ref s) => Some(
            DateTime::parse_from_rfc3339(s)
                .map_err(|_| AppError::BadRequest("Invalid start datetime. Use ISO 8601 format.".into()))?
                .with_timezone(&Utc),
        ),
        None => None,
    };
    let end: Option<DateTime<Utc>> = match params.end {
        Some(ref s) => Some(
            DateTime::parse_from_rfc3339(s)
                .map_err(|_| AppError::BadRequest("Invalid end datetime. Use ISO 8601 format.".into()))?
                .with_timezone(&Utc),
        ),
        None => None,
    };

    // ── Rate limit: 1 per 10 minutes (fail-closed) ──────────────────────
    let rate_key = format!("audit_export_ratelimit:{}", caller.user_id);
    let mut redis_conn = state.redis.clone();

    let exists: bool = crate::discreet_error::redis_or_503(
        redis::cmd("EXISTS")
            .arg(&rate_key)
            .query_async(&mut redis_conn)
            .await,
    )?;

    if exists {
        return Err(AppError::RateLimited(
            "Audit export is limited to 1 per 10 minutes. Please try again later.".into(),
        ));
    }

    let set_result: Result<String, _> = redis::cmd("SET")
        .arg(&rate_key)
        .arg("1")
        .arg("EX")
        .arg(RATE_LIMIT_TTL)
        .query_async(&mut redis_conn)
        .await;
    if let Err(e) = set_result {
        tracing::debug!("audit export rate limit SET failed: {e}");
    }

    // ── Query audit log ─────────────────────────────────────────────────
    let rows: Vec<AuditRow> = query_audit_rows(&state.db, start, end).await?;
    let date = Utc::now().format("%Y-%m-%d").to_string();

    tracing::info!(
        admin = %caller.user_id,
        format = fmt,
        rows = rows.len(),
        "Audit log export generated"
    );

    if fmt == "pdf" {
        let pdf_bytes = build_pdf(&rows, &date)?;
        let filename = format!("attachment; filename=\"audit-log-{date}.pdf\"");
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, HeaderValue::from_static("application/pdf"))
            .header(
                header::CONTENT_DISPOSITION,
                HeaderValue::from_str(&filename).unwrap_or_else(|_| {
                    HeaderValue::from_static("attachment; filename=\"audit-log.pdf\"")
                }),
            )
            .body(Body::from(pdf_bytes))
            .map_err(|e| AppError::Internal(format!("Response build error: {e}")));
    }

    // ── Build CSV ───────────────────────────────────────────────────────
    let csv = build_csv(&rows);
    let filename = format!("attachment; filename=\"audit-log-{date}.csv\"");

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, HeaderValue::from_static("text/csv; charset=utf-8"))
        .header(
            header::CONTENT_DISPOSITION,
            HeaderValue::from_str(&filename).unwrap_or_else(|_| {
                HeaderValue::from_static("attachment; filename=\"audit-log.csv\"")
            }),
        )
        .body(Body::from(csv))
        .map_err(|e| AppError::Internal(format!("Response build error: {e}")))
}

// ─── Data query ─────────────────────────────────────────────────────────

async fn query_audit_rows(
    db: &sqlx::PgPool,
    start: Option<DateTime<Utc>>,
    end: Option<DateTime<Utc>>,
) -> Result<Vec<AuditRow>, AppError> {
    let rows: Vec<AuditRow> = match (start, end) {
        (Some(s), Some(e)) => {
            sqlx::query_as!(
                AuditRow,
                r#"SELECT a.created_at, u.username as actor_username,
                          a.action, a.target_type, a.target_id, a.chain_hash
                   FROM audit_log a
                   LEFT JOIN users u ON u.id = a.actor_id
                   WHERE a.created_at >= $1 AND a.created_at <= $2
                   ORDER BY a.created_at DESC
                   LIMIT $3"#,
                s, e, MAX_ROWS,
            )
            .fetch_all(db)
            .await?
        }
        (Some(s), None) => {
            sqlx::query_as!(
                AuditRow,
                r#"SELECT a.created_at, u.username as actor_username,
                          a.action, a.target_type, a.target_id, a.chain_hash
                   FROM audit_log a
                   LEFT JOIN users u ON u.id = a.actor_id
                   WHERE a.created_at >= $1
                   ORDER BY a.created_at DESC
                   LIMIT $2"#,
                s, MAX_ROWS,
            )
            .fetch_all(db)
            .await?
        }
        (None, Some(e)) => {
            sqlx::query_as!(
                AuditRow,
                r#"SELECT a.created_at, u.username as actor_username,
                          a.action, a.target_type, a.target_id, a.chain_hash
                   FROM audit_log a
                   LEFT JOIN users u ON u.id = a.actor_id
                   WHERE a.created_at <= $1
                   ORDER BY a.created_at DESC
                   LIMIT $2"#,
                e, MAX_ROWS,
            )
            .fetch_all(db)
            .await?
        }
        (None, None) => {
            sqlx::query_as!(
                AuditRow,
                r#"SELECT a.created_at, u.username as actor_username,
                          a.action, a.target_type, a.target_id, a.chain_hash
                   FROM audit_log a
                   LEFT JOIN users u ON u.id = a.actor_id
                   ORDER BY a.created_at DESC
                   LIMIT $1"#,
                MAX_ROWS,
            )
            .fetch_all(db)
            .await?
        }
    };
    Ok(rows)
}

// ─── CSV builder ────────────────────────────────────────────────────────

fn build_csv(rows: &[AuditRow]) -> String {
    let mut csv = String::with_capacity(rows.len() * 128);
    csv.push_str("timestamp,actor_username,action,target,ip_address,hash\n");

    for row in rows {
        let ts = row.created_at.to_rfc3339();
        let actor = csv_escape(row.actor_username.as_deref().unwrap_or(""));
        let action = csv_escape(&row.action);
        let target = format_target(&row.target_type, &row.target_id);
        let target_esc = csv_escape(&target);
        let hash = csv_escape(row.chain_hash.as_deref().unwrap_or(""));

        csv.push_str(&ts);
        csv.push(',');
        csv.push_str(&actor);
        csv.push(',');
        csv.push_str(&action);
        csv.push(',');
        csv.push_str(&target_esc);
        csv.push(',');
        // ip_address — reserved, not yet stored
        csv.push(',');
        csv.push_str(&hash);
        csv.push('\n');
    }
    csv
}

fn csv_escape(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

fn format_target(target_type: &Option<String>, target_id: &Option<Uuid>) -> String {
    match (target_type, target_id) {
        (Some(tt), Some(tid)) => format!("{tt}:{tid}"),
        (Some(tt), None) => tt.clone(),
        _ => String::new(),
    }
}

// ─── PDF builder ────────────────────────────────────────────────────────

/// Column definitions: (header label, width in pt).
const PDF_COLS: &[(&str, f32)] = &[
    ("Timestamp", 120.0),
    ("Actor", 80.0),
    ("Action", 100.0),
    ("Target", 120.0),
    ("IP", 100.0),
    ("Hash", 100.0),
];

/// Build an A4-landscape PDF with a branded header and data table.
fn build_pdf(rows: &[AuditRow], date: &str) -> Result<Vec<u8>, AppError> {
    use printpdf::*;
    use printpdf::path::{PaintMode, WindingOrder};

    // A4 landscape: 842 x 595 pt
    let page_w = Mm(297.0);
    let page_h = Mm(210.0);
    let page_w_pt: f32 = 842.0;
    let page_h_pt: f32 = 595.0;
    let margin: f32 = 36.0; // left/right margin in pt

    let (doc, page1, layer1) = PdfDocument::new("Discreet Audit Report", page_w, page_h, "Layer 1");

    let font_regular = doc.add_builtin_font(BuiltinFont::Helvetica)
        .map_err(|e| AppError::Internal(format!("PDF font error: {e}")))?;
    let font_bold = doc.add_builtin_font(BuiltinFont::HelveticaBold)
        .map_err(|e| AppError::Internal(format!("PDF font error: {e}")))?;

    // Page tracking
    let mut current_layer = doc.get_page(page1).get_layer(layer1);
    let mut page_num = 1_usize;
    let mut y = page_h_pt; // current y position (from top, decreasing)

    // ── Helper: draw text at a position ─────────────────────────────────
    let _draw_text = |layer: &PdfLayerReference, text: &str, x: f32, y_pos: f32, size: f32, font: &IndirectFontRef, r: f32, g: f32, b: f32| {
        layer.use_text(text, size, Mm(x * 0.3528), Mm(y_pos * 0.3528), font);
        layer.set_fill_color(Color::Rgb(Rgb::new(r, g, b, None)));
    };

    // ── Helper: draw filled rectangle ───────────────────────────────────
    let draw_rect = |layer: &PdfLayerReference, x: f32, y_pos: f32, w: f32, h: f32, r: f32, g: f32, b: f32| {
        let points = vec![
            (Point::new(Mm(x * 0.3528), Mm(y_pos * 0.3528)), false),
            (Point::new(Mm((x + w) * 0.3528), Mm(y_pos * 0.3528)), false),
            (Point::new(Mm((x + w) * 0.3528), Mm((y_pos + h) * 0.3528)), false),
            (Point::new(Mm(x * 0.3528), Mm((y_pos + h) * 0.3528)), false),
        ];
        layer.set_fill_color(Color::Rgb(Rgb::new(r, g, b, None)));
        layer.add_polygon(Polygon {
            rings: vec![points],
            mode: PaintMode::Fill,
            winding_order: WindingOrder::NonZero,
        });
    };

    // ── Draw header on a page ───────────────────────────────────────────
    let draw_header = |layer: &PdfLayerReference, y_start: &mut f32| {
        // Green header bar
        draw_rect(layer, 0.0, *y_start - 40.0, page_w_pt, 40.0, 0.0, 0.831, 0.667);
        // Title (white)
        layer.set_fill_color(Color::Rgb(Rgb::new(1.0, 1.0, 1.0, None)));
        layer.use_text("Discreet Audit Report", 14.0, Mm(margin * 0.3528), Mm((*y_start - 28.0) * 0.3528), &font_bold);
        // Date (white, right-aligned approx)
        let date_text = format!("Generated: {date}");
        layer.use_text(&date_text, 9.0, Mm((page_w_pt - margin - 140.0) * 0.3528), Mm((*y_start - 28.0) * 0.3528), &font_regular);
        *y_start -= 50.0; // header height + spacing
    };

    // ── Draw column headers ─────────────────────────────────────────────
    let draw_col_headers = |layer: &PdfLayerReference, y_start: &mut f32| {
        // Light gray background
        draw_rect(layer, margin, *y_start - 14.0, page_w_pt - 2.0 * margin, 16.0, 0.9, 0.9, 0.9);
        let mut x = margin + 4.0;
        layer.set_fill_color(Color::Rgb(Rgb::new(0.15, 0.15, 0.15, None)));
        for (label, width) in PDF_COLS {
            layer.use_text(*label, 9.0, Mm(x * 0.3528), Mm((*y_start - 11.0) * 0.3528), &font_bold);
            x += width;
        }
        *y_start -= 18.0;
    };

    // ── Draw page number ────────────────────────────────────────────────
    let draw_page_num = |layer: &PdfLayerReference, num: usize| {
        layer.set_fill_color(Color::Rgb(Rgb::new(0.5, 0.5, 0.5, None)));
        let text = format!("Page {num}");
        layer.use_text(&text, 8.0, Mm((page_w_pt - margin - 30.0) * 0.3528), Mm(10.0 * 0.3528), &font_regular);
    };

    // ── Start first page ────────────────────────────────────────────────
    draw_header(&current_layer, &mut y);
    draw_col_headers(&current_layer, &mut y);

    let row_height: f32 = 12.0;
    let bottom_margin: f32 = 30.0; // space for page number

    for (i, row) in rows.iter().enumerate() {
        // Check if we need a new page
        if y - row_height < bottom_margin {
            draw_page_num(&current_layer, page_num);
            page_num += 1;
            let (new_page, new_layer) = doc.add_page(page_w, page_h, format!("Layer {page_num}"));
            current_layer = doc.get_page(new_page).get_layer(new_layer);
            y = page_h_pt;
            draw_header(&current_layer, &mut y);
            draw_col_headers(&current_layer, &mut y);
        }

        // Alternating row background
        if i % 2 == 1 {
            draw_rect(&current_layer, margin, y - row_height, page_w_pt - 2.0 * margin, row_height, 0.961, 0.961, 0.961);
        }

        // Row data
        let ts = row.created_at.format("%Y-%m-%d %H:%M:%S").to_string();
        let actor = row.actor_username.as_deref().unwrap_or("");
        let target = format_target(&row.target_type, &row.target_id);
        let hash_full = row.chain_hash.as_deref().unwrap_or("");
        let hash_trunc = if hash_full.len() > 16 { &hash_full[..16] } else { hash_full };

        let cell_values: [&str; 6] = [&ts, actor, &row.action, &target, "", hash_trunc];

        current_layer.set_fill_color(Color::Rgb(Rgb::new(0.1, 0.1, 0.1, None)));
        let mut x = margin + 4.0;
        for (idx, (_, width)) in PDF_COLS.iter().enumerate() {
            // Truncate text to fit column width (approx 1 char = 4pt at 7pt font)
            let max_chars = (*width / 4.0) as usize;
            let text = if cell_values[idx].len() > max_chars {
                &cell_values[idx][..max_chars]
            } else {
                cell_values[idx]
            };
            current_layer.use_text(text, 7.0, Mm(x * 0.3528), Mm((y - 9.0) * 0.3528), &font_regular);
            x += width;
        }

        y -= row_height;
    }

    // Page number on last page
    draw_page_num(&current_layer, page_num);

    // Serialize to bytes
    let pdf_bytes = doc.save_to_bytes()
        .map_err(|e| AppError::Internal(format!("PDF serialization error: {e}")))?;

    Ok(pdf_bytes)
}
