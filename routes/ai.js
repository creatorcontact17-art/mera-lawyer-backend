const express = require("express");
const { protectRoute } = require("../middleware/auth");
const aiController = require("../controllers/aiController");

const router = express.Router();

router.post("/generate", protectRoute, aiController.generate);

module.exports = router;
