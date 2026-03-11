use reqwest::{Client, StatusCode};
use serde_json::{json, Value};
use uuid::Uuid;

const BASE_URL: &str = "http://localhost:3000/api/v1";

#[derive(Debug, Clone)]
struct AuthTokens {
    access_token: String,
    refresh_token: String,
}

fn unique_username(prefix: &str) -> String {
    format!("{}_{}", prefix, Uuid::new_v4().simple())
}

async fn register_user(client: &Client, username: &str, password: &str) -> AuthTokens {
    let response = client
        .post(format!("{BASE_URL}/auth/register"))
        .json(&json!({
            "username": username,
            "password": password,
            "email": format!("{username}@example.com"),
            "display_name": username,
            "device_name": "integration-tests",
        }))
        .send()
        .await
        .expect("register request should succeed");

    assert_eq!(response.status(), StatusCode::CREATED);

    let body: Value = response
        .json()
        .await
        .expect("register response should be valid JSON");

    AuthTokens {
        access_token: body["access_token"]
            .as_str()
            .expect("access_token should be present")
            .to_owned(),
        refresh_token: body["refresh_token"]
            .as_str()
            .expect("refresh_token should be present")
            .to_owned(),
    }
}

#[tokio::test]
async fn register_success_returns_201_and_tokens() {
    let client = Client::new();
    let username = unique_username("reg_ok");

    let response = client
        .post(format!("{BASE_URL}/auth/register"))
        .json(&json!({
            "username": username,
            "password": "password123",
            "email": format!("{username}@example.com"),
            "display_name": "Register Success",
            "device_name": "integration-tests",
        }))
        .send()
        .await
        .expect("register request should succeed");

    assert_eq!(response.status(), StatusCode::CREATED);
    let body: Value = response
        .json()
        .await
        .expect("response should be valid JSON");

    assert!(body["access_token"].as_str().is_some());
    assert!(body["refresh_token"].as_str().is_some());
}

#[tokio::test]
async fn register_duplicate_username_returns_409() {
    let client = Client::new();
    let username = unique_username("dup_user");

    let _tokens = register_user(&client, &username, "password123").await;

    let response = client
        .post(format!("{BASE_URL}/auth/register"))
        .json(&json!({
            "username": username,
            "password": "password123",
            "email": format!("dup_{}@example.com", Uuid::new_v4().simple()),
            "display_name": "Duplicate",
            "device_name": "integration-tests",
        }))
        .send()
        .await
        .expect("duplicate register request should return response");

    assert_eq!(response.status(), StatusCode::CONFLICT);
}

#[tokio::test]
async fn register_empty_username_password_returns_400() {
    let client = Client::new();

    let response = client
        .post(format!("{BASE_URL}/auth/register"))
        .json(&json!({
            "username": "",
            "password": "",
            "email": format!("empty_{}@example.com", Uuid::new_v4().simple()),
            "device_name": "integration-tests",
        }))
        .send()
        .await
        .expect("register request should return response");

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn login_with_correct_credentials_returns_tokens() {
    let client = Client::new();
    let username = unique_username("login_ok");
    let password = "password123";

    let _tokens = register_user(&client, &username, password).await;

    let response = client
        .post(format!("{BASE_URL}/auth/login"))
        .json(&json!({
            "login": username,
            "password": password,
            "device_name": "integration-tests-login",
        }))
        .send()
        .await
        .expect("login request should return response");

    assert_eq!(response.status(), StatusCode::OK);
    let body: Value = response.json().await.expect("response should be valid JSON");
    assert!(body["access_token"].as_str().is_some());
    assert!(body["refresh_token"].as_str().is_some());
}

#[tokio::test]
async fn login_wrong_password_returns_401() {
    let client = Client::new();
    let username = unique_username("wrong_pw");

    let _tokens = register_user(&client, &username, "password123").await;

    let response = client
        .post(format!("{BASE_URL}/auth/login"))
        .json(&json!({
            "login": username,
            "password": "incorrect-password",
            "device_name": "integration-tests-login",
        }))
        .send()
        .await
        .expect("login request should return response");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn login_nonexistent_user_returns_401() {
    let client = Client::new();

    let response = client
        .post(format!("{BASE_URL}/auth/login"))
        .json(&json!({
            "login": unique_username("missing_user"),
            "password": "password123",
            "device_name": "integration-tests-login",
        }))
        .send()
        .await
        .expect("login request should return response");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn refresh_valid_token_returns_new_access_token() {
    let client = Client::new();
    let username = unique_username("refresh_ok");

    let tokens = register_user(&client, &username, "password123").await;

    let response = client
        .post(format!("{BASE_URL}/auth/refresh"))
        .json(&json!({
            "refresh_token": tokens.refresh_token,
        }))
        .send()
        .await
        .expect("refresh request should return response");

    assert_eq!(response.status(), StatusCode::OK);
    let body: Value = response.json().await.expect("response should be valid JSON");
    assert!(body["access_token"].as_str().is_some());
}

#[tokio::test]
async fn refresh_invalid_token_returns_401() {
    let client = Client::new();

    let response = client
        .post(format!("{BASE_URL}/auth/refresh"))
        .json(&json!({
            "refresh_token": "definitely-invalid-refresh-token",
        }))
        .send()
        .await
        .expect("refresh request should return response");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn logout_clears_session() {
    let client = Client::new();
    let username = unique_username("logout_ok");

    let tokens = register_user(&client, &username, "password123").await;

    let logout_response = client
        .post(format!("{BASE_URL}/auth/logout"))
        .bearer_auth(&tokens.access_token)
        .send()
        .await
        .expect("logout request should return response");

    assert_eq!(logout_response.status(), StatusCode::NO_CONTENT);

    let sessions_response = client
        .get(format!("{BASE_URL}/auth/sessions"))
        .bearer_auth(&tokens.access_token)
        .send()
        .await
        .expect("sessions request should return response");

    assert_eq!(sessions_response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn sessions_returns_active_sessions_for_user() {
    let client = Client::new();
    let username = unique_username("sessions_ok");

    let tokens = register_user(&client, &username, "password123").await;

    let response = client
        .get(format!("{BASE_URL}/auth/sessions"))
        .bearer_auth(&tokens.access_token)
        .send()
        .await
        .expect("sessions request should return response");

    assert_eq!(response.status(), StatusCode::OK);
    let sessions: Value = response.json().await.expect("response should be valid JSON");

    let session_list = sessions
        .as_array()
        .expect("sessions response should be a JSON array");
    assert!(!session_list.is_empty());
    assert!(session_list.iter().any(|session| {
        session["current"].as_bool().unwrap_or(false)
            && session["id"].as_str().is_some()
            && session["expires_at"].as_str().is_some()
    }));
}
