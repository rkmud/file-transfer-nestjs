# Backend Application — File Format Converter

## Task

Implement a **Backend application** that provides the ability to convert files from one format to another.

## Functional Requirements

### Architecture

- **Monolithic application**

### User Management

The application must provide the following user management functionality:

- [User Registration](https://app.notion.com/p/3c4e8aa91a7780109d44db6fd6c467c6)
- [RBAC](https://app.notion.com/p/RBAC-3c4e8aa91a77801cbd0dc59ff38ca79a)
- [Authentication](https://app.notion.com/p/RBAC-3c4e8aa91a77801cbd0dc59ff38ca79a)
- [Authorization](https://app.notion.com/p/3c4e8aa91a77801b8673c96d597148c6)
- [View User Data](https://app.notion.com/p/3c4e8aa91a77801f942cdf0528265387)
- [Update User Data](https://app.notion.com/p/3c4e8aa91a778068965cce3cfd998d27)
- [Delete User](https://app.notion.com/p/3c4e8aa91a7780c892fdcd57160bc146)
- [View All Users](https://app.notion.com/p/3c4e8aa91a77808499caed48698d9f4b)

- [General Requirements for File Conversion](https://app.notion.com/p/3c5e8aa91a77809ea43ac8f574ddf182)
- [Text Format Conversion](https://app.notion.com/p/3c6e8aa91a7780b7a518fa644cd8f7d2)
- [Image Transformation](https://app.notion.com/p/3c6e8aa91a77801c8100cbf48af4834b)
- [View the history of a user's file transformations](https://app.notion.com/p/3c6e8aa91a7780e58c24fce905b94594)
- [Saving Transformation Results to the Repository](https://app.notion.com/p/3c6e8aa91a7780e78d06e512dca4e42c)

## Non-Functional Requirements

Where applicable, the application should include:

- **Health checks** (`/health`) for monitoring
- **Rate limiting** to protect against DDoS attacks and brute-force attempts
- **Input validation** for all incoming data
- **CORS** configured to allow requests only from trusted domains
- **Logging** of all critical events, including:
  - authentication attempts
  - errors
  - data changes

- **Test coverage ≥ 80%**, including:
  - unit tests
  - integration tests

- **OpenAPI (Swagger)** with up-to-date API documentation

## Resources

### Boilerplate

Use the following boilerplate as a starting point for the NestJS monolithic application:

[nestjs-monolith-boilerplate](https://github.com/pavel-skripko-innowise/nestjs-monolith-boilerplate)

It contains basic modules and preconfigured integrations required to start a new monolithic NestJS project.
