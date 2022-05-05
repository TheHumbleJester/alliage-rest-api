import { AbstractController } from "alliage-webserver/controller";
import { Get } from "alliage-webserver/controller/decorations";

export default class InvalidStatusCodeController extends AbstractController {
  /**
   * @defaultStatusCode not_a_number
   */
  @Get("/api/get-action")
  async getAction() {
    return {};
  }
}
