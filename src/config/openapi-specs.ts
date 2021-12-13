import openapiSchema from '../generated/schemas/v3.1';
import { FromSchema } from 'json-schema-to-ts';

export const CONFIG_NAME = "rest-api-openapi-specs";

export const schema = openapiSchema;

export type Config = FromSchema<typeof schema>;