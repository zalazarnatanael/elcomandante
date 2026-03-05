const developerService = require('./developer.service');

async function listDevelopers(req, res) {
  try {
    const developers = await developerService.listDevelopers();
    return res.json(developers);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

async function getDeveloper(req, res) {
  try {
    const developer = await developerService.getDeveloper(req.params.username);
    if (!developer) return res.status(404).json({ error: 'Not found' });
    return res.json(developer);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

async function upsertDeveloper(req, res) {
  try {
    const payload = { ...req.validated.body, github_username: req.params.username || req.validated.body.github_username };
    const developer = await developerService.upsertDeveloper(payload);
    return res.json(developer);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

async function deleteDeveloper(req, res) {
  try {
    await developerService.deleteDeveloper(req.params.username);
    return res.status(204).send();
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

module.exports = {
  listDevelopers,
  getDeveloper,
  upsertDeveloper,
  deleteDeveloper
};
