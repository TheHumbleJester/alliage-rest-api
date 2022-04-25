import { AbstractController } from "alliage-webserver/controller";
import { AbstractRequest } from "alliage-webserver/http/request";
import { Service } from "alliage-service-loader/decorators";
import { Post } from "alliage-webserver/controller/decorations";

type Params = {
  /**
   * @pattern "[a-zA-Z]+"
   */
  name: string;
};

type Query = {
  language?: "fr" | "en";
};

type Body = {
  age: number;
};

@Service("main_controller")
export default class MainController extends AbstractController {
  @Post("/api/hello/:name")
  async sayHello(request: AbstractRequest<Params, Query, Body>) {
    const name = request.getParams().name;
    const lang = request.getQuery().language;
    const age = request.getBody().age;
    return {
      message:
        lang === "fr"
          ? `Bonjour ${name}, tu as ${age} ans`
          : `Hello ${name}, you are ${age}`,
    };
  }
}
