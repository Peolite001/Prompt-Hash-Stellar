/**
 * Timeline controllers — user-facing activity feed endpoints (#838).
 */

import { Request, Response } from "express";
import { TimelineService } from "../services/timelineService";
import { logger } from "../services/structuredLogger";
import { paramString } from "./requestParams";

export const GetTimeline = async (
  req: Request,
  res: Response,
): Promise<Response<any>> => {
  try {
    const { walletAddress } = req.params;
    const { limit, cursor, includeMaintainer, eventTypes } = req.query;

    if (!walletAddress) {
      return res.status(400).json({ error: "walletAddress is required" });
    }

    const result = await TimelineService.getTimeline({
      wallet: paramString(walletAddress),
      limit: parseInt(paramString(limit), 10) || 20,
      cursor: paramString(cursor),
      includeMaintainer: includeMaintainer === "true",
      eventTypes: eventTypes
        ? (paramString(eventTypes).split(",") as any)
        : undefined,
    });

    return res.json(result);
  } catch (err) {
    logger.error("Get timeline error", { action: "getTimeline", error: err });
    return res.status(500).json({
      error: (err as Error).message || "Failed to fetch timeline",
    });
  }
};

export const GetResourceTimeline = async (
  req: Request,
  res: Response,
): Promise<Response<any>> => {
  try {
    const { resourceType, resourceId } = req.params;
    const { limit, cursor } = req.query;

    if (!resourceType || !resourceId) {
      return res
        .status(400)
        .json({ error: "resourceType and resourceId are required" });
    }

    const result = await TimelineService.getResourceTimeline({
      resourceType: paramString(resourceType),
      resourceId: paramString(resourceId),
      limit: parseInt(paramString(limit), 10) || 20,
      cursor: paramString(cursor),
    });

    return res.json(result);
  } catch (err) {
    logger.error("Get resource timeline error", {
      action: "getResourceTimeline",
      error: err,
    });
    return res.status(500).json({
      error: (err as Error).message || "Failed to fetch resource timeline",
    });
  }
};
