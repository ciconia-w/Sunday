# Security Policy

## Supported Scope

Sunday is pre-open-source and moving quickly, so the latest `main` branch is
the only supported line by default unless maintainers state otherwise.

## Reporting a Vulnerability

Please report vulnerabilities privately to the maintainers instead of opening a
public issue. Include:

- A clear description of the issue
- Steps to reproduce
- Impact assessment
- Any proof-of-concept or logs needed to verify the problem

If the issue involves credentials, local file access, shell execution, or model
provider secrets, say so explicitly in the report.

## Response Goals

- Initial acknowledgement: within 7 days
- Triage and severity assessment: as soon as practical
- Fix or mitigation plan: communicated after triage

## Handling Guidance

- Do not commit real API keys, tokens, cookies, or personal data.
- Treat file system access, shell execution, and provider credentials as
  high-sensitivity surfaces.
- Prefer private disclosure until a fix is available.
