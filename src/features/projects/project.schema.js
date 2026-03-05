const { z } = require('zod');

const projectBody = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  github_owner: z.string().min(1),
  github_repo: z.string().min(1),
  notion_database_id: z.string().min(1).optional(),
  is_active: z.boolean().optional()
}).strict();

const projectParams = z.object({
  id: z.string().min(1)
});

module.exports = {
  createProjectSchema: z.object({ body: projectBody }),
  updateProjectSchema: z.object({ body: projectBody.partial(), params: projectParams }),
  getProjectSchema: z.object({ params: projectParams })
};
