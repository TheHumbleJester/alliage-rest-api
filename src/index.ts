import { CONFIG_EVENTS, ConfigLoadEvent } from "alliage-config-loader/events";
import { instanceOf, parameter } from "alliage-di/dependencies";
import { ServiceContainer } from "alliage-di/service-container";
import { INIT_EVENTS, LifeCycleInitEvent } from "alliage-lifecycle/events";
import { AbstractLifeCycleAwareModule } from "alliage-lifecycle/module";
import {
  ADAPTER_EVENTS,
  AdapterPostControllerEvent,
  AdapterPreControllerEvent,
  AdapterPreRequestEvent,
} from "alliage-webserver/adapter/events";
import { AbstractRequest } from "alliage-webserver/http/request";
import { validate } from "alliage-config-loader/validators/json-schema";
import { HTTP_METHOD } from "alliage-webserver/http";
import { EventManager } from "alliage-lifecycle/event-manager";

import {
  CONFIG_NAME as MAIN_CONFIG_NAME,
  Config as MainConfig,
  schema as mainSchema,
} from "./config/main";
import {
  CONFIG_NAME as OPENAPI_SPECS_CONFIG_NAME,
  schema as openapiSpecsSchema,
} from "./config/openapi-specs";
import { createHttpError } from "./error";
import { ErrorMiddleware } from "./middleware/error-middleware";
import { JSONParserMiddleware } from "./middleware/json-parser-middleware";
import { ActionMetadata, MetadataManager } from "./service/metadata-manager";
import { Validator } from "./service/validator";
import {
  RestAPIInvalidRequestEvent,
  RestAPIInvalidResponseEvent,
  RestAPIPostValidateRequestEvent,
  RestAPIPostValidateResponseEvent,
  RestAPIPreValidateRequestEvent,
  RestAPIPreValidateResponseEvent,
} from "./events";
import { GenerateSchemaProcess } from "./process/generate-schema-process";
import { SchemaMiddleware } from "./middleware/schema-middleware";
import { GenerateSchemaTask } from "./task/generate-schema-task";

class AlliageRestAPIModule extends AbstractLifeCycleAwareModule {
  private metadataManager!: MetadataManager;
  private validator!: Validator;
  private eventManager!: EventManager;
  private config!: MainConfig;

  private requestMetadataMap = new Map<AbstractRequest, ActionMetadata>();

  getEventHandlers() {
    return {
      [CONFIG_EVENTS.LOAD]: this.handleConfigLoadEvent,
      [INIT_EVENTS.POST_INIT]: this.handlePostInitEvent,
      [ADAPTER_EVENTS.PRE_REQUEST]: this.handlePreRequest,
      [ADAPTER_EVENTS.POST_CONTROLLER]: this.handlePostController,
      [ADAPTER_EVENTS.PRE_CONTROLLER]: this.handlePreController,
      [ADAPTER_EVENTS.SERVER_STARTED]: this.handleServerStarted,
    };
  }

  handleConfigLoadEvent = (event: ConfigLoadEvent) => {
    event
      .addConfig({
        fileName: MAIN_CONFIG_NAME,
        validator: validate(mainSchema),
      })
      .addConfig({
        fileName: OPENAPI_SPECS_CONFIG_NAME,
        validator: validate(openapiSpecsSchema),
      });
  };

  handlePostInitEvent = (event: LifeCycleInitEvent) => {
    const serviceContainer = event.getServiceContainer();
    this.metadataManager = serviceContainer.getService<MetadataManager>(
      "rest-metadata-manager"
    );
    this.validator = serviceContainer.getService<Validator>("rest-validator");
    this.eventManager =
      serviceContainer.getService<EventManager>("event_manager");
    this.config = serviceContainer.getParameter(MAIN_CONFIG_NAME);
  };

  /**
   * Loads the metadata when the server starts
   */
  handleServerStarted = async () => {
    await this.metadataManager.loadMetadata();
  };

  /**
   * Handles CORS preflight requests
   */
  handlePreRequest = (event: AdapterPreRequestEvent) => {
    const request = event.getRequest();
    const response = event.getResponse();
    const corsConfigs = this.config.allowedOrigins;
    const reqOrigin = request.getHeader("Origin");
    if (
      corsConfigs &&
      reqOrigin &&
      ((request.getMethod() === HTTP_METHOD.OPTIONS &&
        (request.getHeader("Access-Control-Request-Method") !== undefined ||
          request.getHeader("Access-Control-Request-Headers") !== undefined)) ||
        request.getMethod() === HTTP_METHOD.GET)
    ) {
      const originCorsConfig = corsConfigs.find(
        ({ origin }) => origin === reqOrigin
      );
      if (originCorsConfig) {
        response.setHeader(
          "Access-Control-Allow-Origin",
          originCorsConfig.origin
        );
        if (request.getMethod() === HTTP_METHOD.OPTIONS) {
          response.setHeader(
            "Access-Control-Allow-Headers",
            originCorsConfig.headers?.join(", ") ?? ""
          );
          response.setHeader(
            "Access-Control-Allow-Methods",
            originCorsConfig.methods?.join(", ") ?? ""
          );
          response.setHeader(
            "Access-Control-Max-Age",
            originCorsConfig.maxAge?.toString() ?? ""
          );
          response.setStatus(204);
          response.end();
        }
      }
    }
  };

  /**
   * Handles request validation
   */
  handlePreController = async (event: AdapterPreControllerEvent) => {
    if (!this.config.validation.requests.enable) {
      return;
    }

    const request = event.getRequest();
    const metadata = this.getRequestMetadata(request);

    if (!metadata || !metadata.validateInput) {
      return;
    }

    const preValidateRequestEvent = new RestAPIPreValidateRequestEvent(
      metadata,
      request
    );
    await this.eventManager.emit(
      preValidateRequestEvent.getType(),
      preValidateRequestEvent
    );
    const errors = this.validator.validateRequest(metadata, request);
    if (errors) {
      const invalidRequestEvent = new RestAPIInvalidRequestEvent(
        metadata,
        request,
        errors
      );
      await this.eventManager.emit(
        invalidRequestEvent.getType(),
        invalidRequestEvent
      );
      throw createHttpError(400, invalidRequestEvent.getErrors());
    }
    const postValidateRequestEvent = new RestAPIPostValidateRequestEvent(
      metadata,
      request
    );
    await this.eventManager.emit(
      postValidateRequestEvent.getType(),
      postValidateRequestEvent
    );
  };

  /**
   * Handles response validation + automatic assignation of reponse's body and status code
   */
  handlePostController = async (event: AdapterPostControllerEvent) => {
    const request = event.getRequest();
    const response = event.getResponse();
    const returnedValue = event.getReturnedValue();
    // We retrieve the metadata previously found
    const metadata = this.getRequestMetadata(request);

    if (returnedValue) {
      response.setBody(returnedValue);
    }

    if (!metadata) {
      return;
    }

    response.setStatus(metadata.defaultStatusCode);

    if (!this.config.validation.responses.enable || !metadata.validateOutput) {
      return;
    }

    const preValidateResponseEvent = new RestAPIPreValidateResponseEvent(
      metadata,
      response
    );
    await this.eventManager.emit(
      preValidateResponseEvent.getType(),
      preValidateResponseEvent
    );
    const errors = this.validator.validateResponse(metadata, response);
    if (errors) {
      const { returnErrors } = this.config.validation.responses.errors;
      const invalidResponseEvent = new RestAPIInvalidResponseEvent(
        metadata,
        response,
        errors
      );
      await this.eventManager.emit(
        invalidResponseEvent.getType(),
        invalidResponseEvent
      );
      // @TODO log error
      if (returnErrors) {
        throw createHttpError(
          this.config.validation.responses.errors.statusCode,
          invalidResponseEvent.getErrors()
        );
      }
    }

    const postValidateResponseEvent = new RestAPIPostValidateResponseEvent(
      metadata,
      response
    );
    await this.eventManager.emit(
      postValidateResponseEvent.getType(),
      postValidateResponseEvent
    );

    // We delete the metadata corresponding to
    // the current request
    this.clearRequestMetadata(request);
  };

  /**
   * Returns metadata corresponding to the given request and cache it
   * @param request
   * @returns
   */
  private getRequestMetadata(request: AbstractRequest) {
    if (this.requestMetadataMap.has(request)) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      return this.requestMetadataMap.get(request)!;
    }
    const metadata = this.metadataManager.findMetadata(
      request.getMethod(),
      request.getPath()
    );
    if (metadata) {
      this.requestMetadataMap.set(request, metadata);
    }

    return metadata;
  }

  /**
   * Clear metadata corresponding to the given request from the cache
   * @param request
   */
  private clearRequestMetadata(request: AbstractRequest) {
    this.requestMetadataMap.delete(request);
  }

  registerServices(serviceContainer: ServiceContainer) {
    serviceContainer.registerService("rest-metadata-manager", MetadataManager, [
      parameter("environment"),
      parameter(`${MAIN_CONFIG_NAME}.metadata.sources`),
      parameter(`${MAIN_CONFIG_NAME}.metadata.path`),
      parameter(`${MAIN_CONFIG_NAME}.development.disableMetadataGeneration`),
    ]);
    serviceContainer.registerService("rest-validator", Validator);
    serviceContainer.registerService(
      "rest-json-parser-middleware",
      JSONParserMiddleware
    );
    serviceContainer.registerService("rest-error-middleware", ErrorMiddleware, [
      instanceOf(EventManager),
      parameter("environment"),
    ]);
    serviceContainer.registerService(
      "rest-schema-middleware",
      SchemaMiddleware,
      [
        instanceOf(MetadataManager),
        parameter(OPENAPI_SPECS_CONFIG_NAME),
        parameter(`${MAIN_CONFIG_NAME}.schema`),
        instanceOf(EventManager),
      ]
    );
    serviceContainer.registerService(
      "rest-generate-schema-process",
      GenerateSchemaProcess,
      [instanceOf(MetadataManager)]
    );
    serviceContainer.registerService(
      "rest-generate-schema-task",
      GenerateSchemaTask,
      [instanceOf(MetadataManager)]
    );
  }
}

export = AlliageRestAPIModule;
