import { handle } from "hono/aws-lambda";
import { createApp } from "./app.js";
import { appDeps, wire } from "./wire.js";

const ready = wire().then((wired) => handle(createApp(appDeps(wired))));

export const handler: ReturnType<typeof handle> = async (event, context) => (await ready)(event, context);
