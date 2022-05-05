import { AbstractController } from "alliage-webserver/controller";
import { Post } from "alliage-webserver/controller/decorations";

export default class NoPromiseActionController extends AbstractController {
  @Post("/api/post-action")
  postAction() {
    return {};
  }
}
