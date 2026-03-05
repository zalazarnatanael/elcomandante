const express = require('express');
const controller = require('./auth.controller');
const { validate } = require('../../shared/utils/validate');
const { signInSchema, refreshSchema, signOutSchema } = require('./auth.schema');

const router = express.Router();

/**
 * @openapi
 * /api/auth/signin:
 *   post:
 *     summary: Sign in with Supabase email/password
 *     tags:
 *       - Auth
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: Session tokens and user profile
  *         content:
  *           application/json:
  *             examples:
  *               success:
  *                 value:
  *                   access_token: "eyJhbGciOi..."
  *                   refresh_token: "eyJhbGciOi..."
  *                   expires_in: 3600
  *                   token_type: "bearer"
  *                   user:
  *                     id: "user-123"
  *                     email: "user@example.com"
 *       401:
 *         description: Invalid credentials
 */
router.post('/signin', validate(signInSchema), controller.signIn);

/**
 * @openapi
 * /api/auth/refresh:
 *   post:
 *     summary: Refresh Supabase session
 *     tags:
 *       - Auth
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refresh_token]
 *             properties:
 *               refresh_token: { type: string }
 *     responses:
 *       200:
 *         description: Refreshed session tokens
 *         content:
 *           application/json:
 *             examples:
 *               success:
 *                 value:
 *                   access_token: "eyJhbGciOi..."
 *                   refresh_token: "eyJhbGciOi..."
 *                   expires_in: 3600
 *                   token_type: "bearer"
 *                   user:
 *                     id: "user-123"
 *                     email: "user@example.com"
 *       401:
 *         description: Invalid refresh token
 */
router.post('/refresh', validate(refreshSchema), controller.refreshToken);

/**
 * @openapi
 * /api/auth/signout:
 *   post:
 *     summary: Sign out and revoke refresh token
 *     tags:
 *       - Auth
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [access_token, refresh_token]
 *             properties:
 *               access_token: { type: string }
 *               refresh_token: { type: string }
 *     responses:
 *       200:
 *         description: Signed out
 *         content:
 *           application/json:
 *             examples:
 *               success:
 *                 value:
 *                   ok: true
 */
router.post('/signout', validate(signOutSchema), controller.signOut);

/**
 * @openapi
 * /api/auth/me:
 *   get:
 *     summary: Get current user from Supabase JWT
 *     tags:
 *       - Auth
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: JWT claims
  *         content:
  *           application/json:
  *             examples:
  *               success:
  *                 value:
  *                   user:
  *                     sub: "user-123"
  *                     email: "user@example.com"
  *                     role: "authenticated"
 *       401:
 *         description: Missing token
 *       403:
 *         description: Invalid token
 */
router.get('/me', controller.getMe);

module.exports = router;
