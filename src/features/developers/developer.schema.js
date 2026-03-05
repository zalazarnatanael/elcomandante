const { z } = require('zod');

const developerBody = z.object({
  github_username: z.string().min(1),
  token: z.string().min(1).optional(),
  commit_name: z.string().min(1).optional(),
  commit_email: z.string().min(1).optional(),
  is_active: z.boolean().optional(),
  notes: z.string().optional()
}).strict();

const params = z.object({
  username: z.string().min(1)
});

module.exports = {
  upsertDeveloperSchema: z.object({ body: developerBody }),
  getDeveloperSchema: z.object({ params }),
  deleteDeveloperSchema: z.object({ params })
};
