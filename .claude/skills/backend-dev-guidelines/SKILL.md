---
name: backend-dev-guidelines
description: Comprehensive guide for Node.js/Express/TypeScript microservices. Mandatory for creating routes, controllers, services, repositories, Prisma, Sentry, and Zod validation.
---

# 🏗️ Backend Development Guidelines (System Skill)

> **Context**: To be used across all microservices (blog-api, auth-service, notifications-service).
> **Architecture**: Layered Architecture (Routes → Controllers → Services → Repositories).

## 🎯 Purpose
Establish consistency and best practices by eliminating anti-patterns and ensuring each layer fulfills a single responsibility under the principles of Dependency Injection and Strong Typing.

## 🛠️ Tech Stack & Tooling
- **Runtime/Language**: Node.js, TypeScript.
- **Framework**: Express.js (BaseController pattern).
- **ORM**: Prisma (Repository Pattern).
- **Validation**: Zod (Mandatory schemas for every Request).
- **Monitoring/Errors**: Sentry (instrument.ts) + Error Boundary.
- **Configuration**: `unifiedConfig` (Usage of `process.env` is strictly forbidden).

## 🧱 Layered Architecture (Responsibilities)

1. **Routes**: Define endpoints and HTTP methods only. Delegate immediately to the Controller.
2. **Controllers**: Must extend `BaseController`. Handle the HTTP interface (res.send, status codes, DTO mapping).
3. **Services**: Contain the **Business Logic**. Must be agnostic to the HTTP protocol.
4. **Repositories**: Exclusive access to the database via Prisma. Abstract complex queries and transactions.

## 📏 7 Golden Rules (Core Principles)

1. **Routes Only Route**: Zero logic allowed in route files.
2. **BaseController**: All controllers must extend the base class for uniform response handling and error wrapping.
3. **Sentry Everywhere**: Every caught error must be reported to Sentry before returning a response to the client.
4. **UnifiedConfig**: Never use `process.env`. Use the injected `unifiedConfig` object for all environment variables.
5. **Zod Validation**: No request shall be processed without validating `body`, `params`, or `query` against a Zod schema.
6. **Repository Pattern**: Do not call `prisma.model.find` directly in the Service; use the corresponding Repository.
7. **Async Safety**: Use `asyncErrorWrapper` or the integrated try/catch blocks in `BaseController` to prevent unhandled promise rejections.

## 🧪 Implementation Checklist
- [ ] **Route**: Clean definition, delegated to controller.
- [ ] **Controller**: Extends `BaseController`, uses validated DTOs.
- [ ] **Service**: Pure business logic with Dependency Injection.
- [ ] **Validation**: Zod schema defined and exported for the request.
- [ ] **Sentry**: Error and performance tracking integrated.
- [ ] **Config**: Exclusive use of `unifiedConfig`.
- [ ] **Tests**: Unit + Integration tests created with feature.

## 🚫 Anti-Patterns to Avoid
- ❌ Business logic inside Routes.
- ❌ Direct `process.env` usage anywhere outside the config initialization.
- ❌ `console.log` in production (Use Sentry/Logger).
- ❌ Bypassing the Service layer to call the Repository from the Controller.
- ❌ Manual HTTP status codes (Use `BaseController` constants/methods).

## 📁 Naming Conventions
- **Controllers**: `PascalCase` (e.g., `UserController.ts`)
- **Services**: `camelCase` (e.g., `userService.ts`)
- **Routes**: `camelCase + Routes` (e.g., `userRoutes.ts`)
- **Repositories**: `PascalCase + Repository` (e.g., `UserRepository.ts`)

---

## 🚀 Task Finalization Reminder
**🚨 IMPORTANTE:** Antes de cerrar este ticket o considerar la tarea terminada, asegúrate de haber completado el checklist de pruebas en `testing-guide.md`.
**Sin tests, la tarea NO está terminada.**

---
**Final Instruction**: When detecting backend-related tasks, assume the role of a "Senior Backend Engineer" strictly following these guidelines. Prioritize data security, code modularity, and microservice scalability.