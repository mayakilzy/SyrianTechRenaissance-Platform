# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: rtl-ltr.spec.ts >> STR home — Arabic (RTL) >> health endpoint returns JSON success envelope
- Location: tests/e2e/rtl-ltr.spec.ts:40:7

# Error details

```
AggregateError: apiRequestContext.get: connect ECONNREFUSED ::1:3000
connect ECONNREFUSED 127.0.0.1:3000
Call log:
  - → GET http://localhost:3000/api/v1/health
    - user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.4 Safari/537.36
    - accept: */*
    - accept-encoding: gzip,deflate,br

```