import express from "express";
import {
  handleBitbucketPushRequest,
  handleGithubPushRequest,
} from "../services/scmPushWebhook.service.js";

const router = express.Router();

function isJsonOrVendorContentType(req) {
  const ct = String(req.headers["content-type"] || "").toLowerCase();
  return ct.includes("application/json") || ct.includes("application/vnd.api+json");
}

const rawJson = express.raw({ type: isJsonOrVendorContentType, limit: "25mb" });

router.post("/github/push", rawJson, (req, res, next) => {
  handleGithubPushRequest(req, res).catch(next);
});

router.post("/bitbucket/push", rawJson, (req, res, next) => {
  handleBitbucketPushRequest(req, res).catch(next);
});

export default router;
