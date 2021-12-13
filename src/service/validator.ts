interface ValidateRequestContent {
  body: unknown;
  query: Record<string, unknown>;
  params: Record<string, unknown>
}

export class Validator {
  validateRequest({ body, query, params }: ValidateRequestContent) {
    return {}
  }
}