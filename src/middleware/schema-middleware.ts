import { REQUEST_PHASE } from "alliage-webserver/adapter";
import { AbstractMiddleware } from "alliage-webserver/middleware";
import { Context } from "alliage-webserver/middleware/context";
import { Config as OpenApiSpecs } from "config/openapi-specs";
import { Config } from "config/main";
import { MetadataManager } from "service/metadata-manager";
import { EventManager } from "alliage-lifecycle/event-manager";
import { RestAPIPostGenerateSchemaEvent, RestAPIPreGenerateSchemaEvent } from "../events";

/**
 * Exposes the OpenAPI schema endpoint
 */
export default class SchemaMiddleware extends AbstractMiddleware {
  private schema: OpenApiSpecs | undefined;

  constructor(
    private metadataManager: MetadataManager,
    private openApiSpecs: OpenApiSpecs,
    private schemaConfig: Config["schema"],
    private eventManager: EventManager
  ) {
    super();
  }

  getRequestPhase = () => REQUEST_PHASE.PRE_CONTROLLER;

  /**
   * Generates the OpenAPI schema
   * @returns OpenAPI schema
   */
  private generateSchema() {
    if (this.schema) {
      return this.schema;
    }

    const preEvent = new RestAPIPreGenerateSchemaEvent(this.metadataManager.getMetadata());
    this.eventManager.emit(preEvent.getType(), preEvent);

    const metadata = preEvent.getMetadata();

    const paths = Object.entries(metadata).reduce(
      (paths, [method, metadata]) => {
        return metadata.reduce((p, { path, actionMetadata }) => {
          const params =
            typeof actionMetadata.paramsType !== "boolean"
              ? actionMetadata.paramsType
              : {};
          const query =
            typeof actionMetadata.queryType !== "boolean"
              ? actionMetadata.queryType
              : {};
          return {
            ...p,
            [path]: {
              ...(p as Record<string, object>)[path],
              [method.toLowerCase()]: {
                parameters: {
                  ...Object.entries(params.properties ?? {}).reduce(
                    (acc, [name, schema]) => {
                      return {
                        ...acc,
                        [name]: {
                          schema,
                          in: "path",
                          required: true,
                        },
                      };
                    },
                    {}
                  ),
                  ...Object.entries(query.properties ?? {}).reduce(
                    (acc, [name, schema]) => {
                      return {
                        ...acc,
                        [name]: {
                          schema,
                          in: "query",
                          required: query.required?.includes(name) ?? false,
                        },
                      };
                    },
                    {}
                  ),
                },
                requestBody: actionMetadata.bodyType,
                responses: {
                  [actionMetadata.defaultStatusCode]: {
                    content: {
                      ["application/json"]: {
                        schema: actionMetadata.returnType,
                      },
                    },
                  },
                  ...actionMetadata.errors.reduce((responses, error) => {
                    return {
                      ...responses,
                      [error.code]: {
                        description: error.description,
                        content: {
                          ["application/json"]: {
                            schema: error.payloadType,
                          },
                        },
                      },
                    };
                  }, {}),
                },
              },
            },
          };
        }, paths);
      },
      {}
    );

    this.schema = {
      ...this.openApiSpecs,
      paths: {
        ...paths,
        ...(this.openApiSpecs.paths as object),
      },
    };

    const postEvent = new RestAPIPostGenerateSchemaEvent(metadata, this.schema);
    this.eventManager.emit(postEvent.getType(), postEvent);
    return postEvent.getSchema();
  }

  async apply(context: Context) {
    const request = context.getRequest();
    if (
      this.schemaConfig.enable &&
      request.getPath() === this.schemaConfig.path
    ) {
      const schema = this.generateSchema();
      context.getResponse().setStatus(200).setBody(schema).end();
    }
  }
}
