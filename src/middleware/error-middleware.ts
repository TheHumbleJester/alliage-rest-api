import { REQUEST_PHASE } from "alliage-webserver/adapter";
import { AbstractMiddleware } from "alliage-webserver/middleware";
import { Context } from "alliage-webserver/middleware/context";
import { HttpError } from "../error";

export default class ErrorMiddleware extends AbstractMiddleware {
  constructor(private env: string) {
    super();
  }

  getRequestPhase = () => REQUEST_PHASE.POST_CONTROLLER;

  apply(context: Context, error: Error) {
    const response = context.getResponse();
    if (error instanceof HttpError) {
      response.setStatus(error.code).setBody(error.payload);
    } else {
      response.setStatus(500).setBody({
        message: "Internal error",
        debug:
          this.env === "development"
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
              }
            : undefined,
      });
    }
    response.end();
  }
}
