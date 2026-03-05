const { z } = require('zod');

const signInBody = z.object({
  email: z.string().email(),
  password: z.string().min(1)
}).strict();

const refreshBody = z.object({
  refresh_token: z.string().min(1)
}).strict();

const signOutBody = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1)
}).strict();

module.exports = {
  signInSchema: z.object({ body: signInBody }),
  refreshSchema: z.object({ body: refreshBody }),
  signOutSchema: z.object({ body: signOutBody })
};
