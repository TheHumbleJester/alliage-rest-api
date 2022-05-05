import { AbstractController } from "alliage-webserver/controller";
import { Get } from "alliage-webserver/controller/decorations";

import { createHttpError } from "../../../error";

export default class NoNumberLitteralErrorCodeController extends AbstractController {
  @Get("/api/get-action")
  async getAction() {
    if (Math.random() > 0.5) {
      const errorCode = parseInt("404", 10);
      throw createHttpError(errorCode, { message: "error" });
    }
    return {};
  }
}
