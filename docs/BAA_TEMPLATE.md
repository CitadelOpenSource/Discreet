# Business Associate Agreement Template

> **Notice:** This template does not constitute legal advice. Organizations should consult qualified healthcare legal counsel before execution. This document is provided as a starting point for HIPAA-covered entities evaluating Discreet for use in environments where Protected Health Information may be transmitted or stored.

---

## Section 1: Parties

This Business Associate Agreement ("Agreement") is entered into as of **\_\_\_\_\_\_\_\_\_\_\_\_\_\_** ("Effective Date") by and between:

**Covered Entity:**

| Field | Value |
|-------|-------|
| Organization Name | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ |
| Address | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ |
| Contact Name | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ |
| Contact Email | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ |

**Business Associate:**

| Field | Value |
|-------|-------|
| Organization Name | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ |
| Address | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ |
| Contact Name | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ |
| Contact Email | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ |

---

## Section 2: Definitions

The following terms shall have the meanings ascribed to them under the HIPAA Privacy Rule (45 CFR Part 160 and Subparts A and E of Part 164), the HIPAA Security Rule (45 CFR Part 160 and Subparts A and C of Part 164), and the HITECH Act, as amended:

**Protected Health Information (PHI):** Individually identifiable health information, as defined in 45 CFR 160.103, that is transmitted or maintained in any form or medium by Business Associate on behalf of Covered Entity.

**Electronic Protected Health Information (ePHI):** PHI that is transmitted by or maintained in electronic media, as defined in 45 CFR 160.103.

**Security Incident:** The attempted or successful unauthorized access, use, disclosure, modification, or destruction of information or interference with system operations in an information system, as defined in 45 CFR 164.304.

**Breach:** The acquisition, access, use, or disclosure of PHI in a manner not permitted under the HIPAA Privacy Rule which compromises the security or privacy of the PHI, as defined in 45 CFR 164.402.

---

## Section 3: Obligations of Business Associate

Business Associate agrees to:

### 3.1 Encryption

Use end-to-end encryption for all ePHI at rest and in transit:
- **At rest:** AES-256-GCM with HKDF-SHA256 key derivation (NIST SP 800-38D, RFC 5869). All message content, file attachments, and AI agent memory are stored as ciphertext that the server cannot decrypt.
- **In transit:** TLS 1.3 with HSTS preload (max-age=63072000, includeSubDomains). WebSocket connections are encrypted via the same TLS termination.

### 3.2 Access Controls

Implement role-based access controls (RBAC):
- Server-level permissions via bitfield flags, including `MANAGE_SERVER`, `MANAGE_CHANNELS`, `MANAGE_MEMBERS`, `MANAGE_ROLES`, and `VIEW_AUDIT_LOG`.
- Channel-level permission overrides for granular access restriction.
- Minimum necessary access enforced by default — new members receive base permissions only.
- Administrative actions require explicit privilege escalation.

### 3.3 Audit Logging

Maintain tamper-evident audit logs:
- SHA-256 hash-chain audit log where each entry chains to the previous via `prev_hash` and monotonic `sequence_num`.
- Audit records include: timestamp, actor, action, target, and IP address.
- Verification endpoint walks the chain and recomputes hashes to detect tampering.
- Audit logs are exportable in CSV and PDF formats for compliance review.

### 3.4 Security Incident Reporting

Report any Security Incident to Covered Entity within **24 hours** of discovery. The report shall include:
- Date and time of discovery
- Nature and scope of the incident
- PHI involved or potentially involved
- Corrective actions taken or planned

### 3.5 Minimum Necessary Workforce

Restrict access to ePHI to the minimum necessary workforce members required to perform services under this Agreement. Business Associate shall maintain a record of persons authorized to access systems containing ePHI.

### 3.6 Subcontractors

Ensure that any subcontractors that create, receive, maintain, or transmit ePHI on behalf of Business Associate agree to the same restrictions and conditions that apply to Business Associate under this Agreement.

### 3.7 Availability

Make ePHI available to Covered Entity as necessary to satisfy Covered Entity's obligations under 45 CFR 164.524 (individual access to PHI).

---

## Section 4: Permitted Uses and Disclosures

Business Associate may use or disclose PHI only as necessary to perform services under the underlying service agreement between the parties, or as required by law. Business Associate shall not use or disclose PHI in a manner that would violate the HIPAA Privacy Rule if done by Covered Entity.

Specifically, Business Associate may:
- Transmit, process, and store encrypted messages on behalf of Covered Entity's authorized users
- Maintain encrypted backups for disaster recovery purposes
- Generate de-identified usage analytics (message counts, storage utilization) that contain no PHI

Business Associate shall not:
- Decrypt, access, or attempt to access the content of encrypted messages (the system architecture makes this technically infeasible)
- Sell PHI or use it for marketing purposes
- Disclose PHI to any third party without prior written authorization from Covered Entity, except as required by law

---

## Section 5: Technical Safeguards

Business Associate implements the following technical safeguards in accordance with 45 CFR 164.312:

| Safeguard | Implementation |
|-----------|----------------|
| Encryption (at rest) | AES-256-GCM with HKDF-SHA256 key derivation (NIST SP 800-38D, RFC 5869) |
| Encryption (in transit) | TLS 1.3 with HSTS preload, certificate transparency |
| Key derivation | HKDF-SHA256 with domain-separated salts (`discreet-mls-v1`, `discreet-agent-v1`) |
| Password hashing | Argon2id (memory=19456 KiB, iterations=2, parallelism=1), per OWASP recommendation |
| Multi-factor authentication | TOTP (RFC 6238) with encrypted secret storage, FIDO2 passkeys (WebAuthn Level 2) via hardware security modules |
| Group key management | MLS (RFC 9420) via OpenMLS with forward secrecy and post-compromise security |
| Access control | RBAC with 22 permission bitflags, channel-level overrides, automatic session expiry |
| Audit logging | SHA-256 hash-chain with tamper detection, exportable in CSV/PDF |
| Session management | JWT access tokens (15-min expiry), HttpOnly refresh cookies (SHA-256 hashed before storage), session revocation on password change |
| Account protection | Account lockout after 5 failed attempts (15-min cooldown), identical error messages for "user not found" and "wrong password" |
| SQL injection prevention | All database queries use sqlx compile-time validation — zero string interpolation |
| Input validation | Centralized validators on all endpoints (length, format, allowed characters) |

---

## Section 6: Breach Notification Procedures

### 6.1 Notification

In the event of a Breach of Unsecured PHI, Business Associate shall notify Covered Entity without unreasonable delay and in no case later than **24 hours** after discovery of the Breach.

### 6.2 Investigation

Business Associate shall promptly investigate any Breach or suspected Breach and shall:
- Identify the nature and extent of the ePHI involved
- Identify the unauthorized person(s) who accessed or used the ePHI
- Determine whether the ePHI was actually acquired or viewed
- Assess the extent to which the risk to the ePHI has been mitigated

### 6.3 Mitigation

Business Associate shall take immediate steps to mitigate any harmful effects of the Breach, including:
- Revoking compromised access credentials
- Rotating encryption keys for affected channels
- Preserving audit logs for forensic analysis
- Implementing additional safeguards to prevent recurrence

### 6.4 Written Report

Within **72 hours** of discovery, Business Associate shall provide Covered Entity with a written report containing:
- A description of the Breach, including the date of the Breach and the date of discovery
- A description of the types of ePHI involved
- Identification of each individual whose ePHI has been, or is reasonably believed to have been, accessed, acquired, used, or disclosed
- A description of the investigative and mitigation steps taken
- Contact information for individuals who can provide additional information

---

## Section 7: Term and Termination

### 7.1 Term

This Agreement shall be effective as of the Effective Date and shall remain in effect until all obligations under this Agreement have been satisfied or until terminated as provided herein.

### 7.2 Termination for Cause

Covered Entity may terminate this Agreement if Covered Entity determines that Business Associate has materially violated a term of this Agreement and Business Associate has not cured the violation within **30 days** of receiving written notice.

### 7.3 Effect of Termination

Upon termination, Business Associate shall return or destroy all PHI in its possession, as directed by Covered Entity under Section 8.

---

## Section 8: Return or Destruction of PHI

### 8.1 Upon Termination

Upon termination of this Agreement, Business Associate shall, at the direction of Covered Entity:
- **Return** all ePHI to Covered Entity in a standard, portable format (encrypted export archive), or
- **Destroy** all ePHI in its possession, including all copies in backups, databases, and any other storage media

### 8.2 Certification

Business Associate shall certify in writing to Covered Entity that all ePHI has been returned or destroyed within **30 days** of termination.

### 8.3 Infeasibility

If return or destruction is infeasible, Business Associate shall:
- Notify Covered Entity in writing of the conditions that make return or destruction infeasible
- Extend the protections of this Agreement to such ePHI for as long as it is retained
- Limit further uses and disclosures to those purposes that make the return or destruction infeasible

---

## Section 9: Signatures

| | Covered Entity | Business Associate |
|---|---|---|
| **Signature** | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ |
| **Printed Name** | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ |
| **Title** | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ |
| **Date** | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ |

---

> **Disclaimer:** This template is provided for informational purposes only and does not constitute legal advice. The template may not address all requirements applicable to your organization under HIPAA, HITECH, or state privacy laws. Organizations should consult qualified healthcare legal counsel before executing this or any Business Associate Agreement. Citadel Open Source LLC makes no representations or warranties regarding the legal sufficiency of this template.
