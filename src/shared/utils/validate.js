function validate(schema) {
  return (req, res, next) => {
    try {
      req.validated = schema.parse({
        body: req.body,
        params: req.params,
        query: req.query
      });
      return next();
    } catch (error) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors || error.message
      });
    }
  };
}

module.exports = { validate };
