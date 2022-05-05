import { AbstractController } from "alliage-webserver/controller";
import { Get } from "alliage-webserver/controller/decorations";

export class NoDefaultExportController extends AbstractController {
  @Get("/api/get-action")
  async getAction() {
    return {};
  }
}
