import { parameter } from "alliage-di/dependencies";
import { ServiceContainer } from "alliage-di/service-container";
import { INIT_EVENTS, LifeCycleInitEvent } from "alliage-lifecycle/events";
import { AbstractLifeCycleAwareModule } from "alliage-lifecycle/module";
import {
  AdapterPostControllerEvent,
  AdapterPreControllerEvent,
  ADAPTER_EVENTS,
} from "alliage-webserver/adapter/events";
import { createHttpError } from "./error";
import ErrorMiddleware from "./middleware/error-middleware";
import JSONParserMiddleware from "./middleware/json-parser-middleware";
import { MetadataManager } from "./service/metadata-manager";
import { Validator } from "./service/Validator";

export default class AlliageRestAPIModule extends AbstractLifeCycleAwareModule {
  private metadataManager!: MetadataManager;
  private validator!: Validator;

  getEventHandlers() {
    return {
      [INIT_EVENTS.POST_INIT]: this.handlePostInitEvent,
      [ADAPTER_EVENTS.POST_CONTROLLER]: this.handlePostController,
      [ADAPTER_EVENTS.PRE_CONTROLLER]: this.handlePreController,
      [ADAPTER_EVENTS.SERVER_STARTED]: this.handleServerStarted,
    };
  }

  handlePostInitEvent = async (event: LifeCycleInitEvent) => {
    const serviceContainer = event.getServiceContainer();
    this.metadataManager = serviceContainer.getService<MetadataManager>(
      "rest_metadata_manager"
    );
    this.validator = serviceContainer.getService<Validator>("rest_validator");
  };

  handleServerStarted = async () => {
    await this.metadataManager.loadMetadata();
  };

  handlePreController = (event: AdapterPreControllerEvent) => {
    const request = event.getRequest();
    const errors = this.validator.validateRequest({
      body: request.getBody(),
      params: request.getParams(),
      query: request.getQuery(),
    });
    if (errors) {
      throw createHttpError(400, errors);
    }
  };

  handlePostController(event: AdapterPostControllerEvent) {
    const returnedValue = event.getReturnedValue();
    const request = event.getRequest();

    const metadata = this.metadataManager.readMetadata(
      request.getMethod(),
      request.getPath()
    );
    if (returnedValue) {
      event.getResponse().setBody(returnedValue);
    }
  }

  registerServices(serviceContainer: ServiceContainer) {
    serviceContainer.registerService("rest_metadata_manager", MetadataManager);
    serviceContainer.registerService("rest_validator", Validator);
    serviceContainer.registerService(
      "rest_json_parser_middleware",
      JSONParserMiddleware
    );
    serviceContainer.registerService("rest_error_middleware", ErrorMiddleware, [
      parameter("evironment"),
    ]);
  }
}
