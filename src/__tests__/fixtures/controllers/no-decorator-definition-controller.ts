import { AbstractController } from "alliage-webserver/controller";
import { Post } from "alliage-webserver/controller/decorations";

export default class NoDecoratorDefinitionController extends AbstractController {
  @Get("/api/get-action")
  async getAction() {
    return {};
  }

  @Post("/api/post-action")
  async postAction() {
    return {};
  }
}
