import { REQUEST_PHASE } from "alliage-webserver/adapter";
import { AbstractMiddleware } from "alliage-webserver/middleware";
import { Context } from "alliage-webserver/middleware/context";

/**
 * Transforms JSON string in the request body in an actual javascript object
 */
export default class JSONParserMiddleware extends AbstractMiddleware {
  getRequestPhase = () => REQUEST_PHASE.PRE_CONTROLLER;

  async apply(context: Context) {
    const request = context.getRequest();
    if (request.getHeader("Content-Type") === "application/json") {
      let content = "";
      const stream = request.getReadableStream();
      stream.on("data", (data) => (content += data));
      await new Promise((resolve, reject) => {
        stream.on("end", resolve);
        stream.on("error", reject);
      });
      request.setBody(JSON.parse(content));
    }
  }
}
