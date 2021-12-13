import {
  JSONSchema6,
  JSONSchema6Definition,
  JSONSchema6TypeName,
} from "json-schema";
import { ts, Type, Symbol } from "ts-morph";

interface JSDocProperties {
  description?: string;
  ignore?: boolean;
  type?: JSONSchema6TypeName;
}

function tryOrReturn<FuncReturn, FallbackReturn>(
  f: () => FuncReturn,
  fallback: FallbackReturn
): FuncReturn | FallbackReturn {
  try {
    return f();
  } catch (e) {
    return fallback;
  }
}

function convertNumberTypeToJsonSchema(): JSONSchema6Definition {
  return {
    type: "number",
  };
}

function convertNumberLiteralTypeToJsonSchema(
  t: Type<ts.Type>
): JSONSchema6Definition {
  return {
    type: "string",
    enum: [t.getLiteralValue() as number],
  };
}

function convertBooleanTypeToJsonSchema(): JSONSchema6Definition {
  return {
    type: "boolean",
  };
}

function convertBooleanLiteralTypeToJsonSchema(
  t: Type<ts.Type>
): JSONSchema6Definition {
  return {
    type: "boolean",
    enum: [t.getText() === "true"],
  };
}

function convertStringTypeToJsonSchema(): JSONSchema6Definition {
  return {
    type: "string",
  };
}

function convertStringLiteralTypeToJsonSchema(
  t: Type<ts.Type>
): JSONSchema6Definition {
  return {
    type: "string",
    enum: [t.getLiteralValue() as string],
  };
}

function convertArrayTypeToJsonSchema(
  t: Type<ts.Type>,
  path: string[],
  visitedTypes: { type: Type<ts.Type>; path: string[] }[]
): JSONSchema6Definition {
  const arrayElementType = t.getArrayElementType();
  return {
    type: "array",
    items:
      arrayElementType &&
      convertTypeToJsonSchema(
        arrayElementType,
        [...path, "items"],
        visitedTypes
      ),
  };
}

function convertTupleTypeToJsonSchema(
  t: Type<ts.Type>,
  path: string[],
  visitedTypes: { type: Type<ts.Type>; path: string[] }[]
): JSONSchema6Definition {
  return {
    type: "array",
    items: t
      .getTupleElements()
      .map((subType, index) =>
        convertTypeToJsonSchema(
          subType,
          [...path, "items", index.toString()],
          visitedTypes
        )
      ),
  };
}

function extractJSdocProperties(s: Symbol): JSDocProperties {
  const description = s.compilerSymbol
    .getDocumentationComment(undefined)
    .map((c) => c.text)
    .join("\n");
  return {
    description: description !== "" ? description : undefined,
    ...s.getJsDocTags().reduce((acc, tag) => {
      return {
        ...acc,
        [tag.getName()]: tryOrReturn(
          () =>
            JSON.parse(
              tag
                .getText()
                .map((t) => t.text)
                .join("")
            ),
          undefined
        ),
      };
    }, {}),
  };
}

function convertObjectTypeToJsonSchema(
  t: Type<ts.Type>,
  path: string[],
  visitedTypes: { type: Type<ts.Type>; path: string[] }[]
): JSONSchema6Definition {
  // If the type has been already visited then we're in a recursion
  // so we simply make a ref to that type
  const visitedType = visitedTypes.find((vt) => vt.type === t);
  if (visitedType) {
    return {
      $ref: `#/${visitedType.path.join("/")}`,
    };
  }

  const updatedVisitedTypes = [
    ...visitedTypes,
    {
      type: t,
      path,
    },
  ];

  const required: string[] = [];
  const properties = t
    .getProperties()
    .reduce((acc: Record<string, JSONSchema6Definition>, property) => {
      const jsDocProps = extractJSdocProperties(property);
      if (jsDocProps.ignore) {
        return acc;
      }
      const type = property.getDeclarations()[0]?.getType();
      if (!type) {
        return acc;
      }
      if (!type.isNullable()) {
        required.push(property.getName());
      }
      let schema: JSONSchema6Definition;
      if (jsDocProps.type) {
        schema = jsDocProps;
      } else {
        const convertedSchema = convertTypeToJsonSchema(
          type,
          [...path, "properties", property.getName()],
          updatedVisitedTypes
        );
        schema = {
          ...jsDocProps,
          ...(typeof convertedSchema === "object" ? convertedSchema : {}),
        };
      }
      return {
        ...acc,
        [property.getName()]: schema,
      };
    }, {});
  const additionalPropertiesType =
    t.getStringIndexType() || t.getNumberIndexType();
  return {
    type: "object",
    additionalProperties: additionalPropertiesType
      ? convertTypeToJsonSchema(
          additionalPropertiesType,
          [...path, "additionalProperties"],
          updatedVisitedTypes
        )
      : false,
    required,
    properties,
  };
}

function convertEnumTypeToJsonSchema(t: Type<ts.Type>): JSONSchema6Definition {
  const symbol = t.getSymbol();
  if (!symbol) {
    return {};
  }

  const values = symbol.getDeclarations().flatMap((n) => {
    return (
      n
        .asKind(ts.SyntaxKind.EnumDeclaration)
        ?.getMembers()
        .flatMap((m) => {
          const value = m.getValue();
          return value !== undefined ? [value] : [];
        }) ?? []
    );
  });

  if (values.length === 0) {
    return {};
  }

  return {
    type: typeof values[0] === "string" ? "string" : "number",
    enum: values,
  };
}

function convertUnionTypeToJsonSchema(
  t: Type<ts.Type>,
  path: string[],
  visitedTypes: { type: Type<ts.Type>; path: string[] }[]
): JSONSchema6Definition {
  const types = t.getUnionTypes();
  const stringsOnly = types.every((subType) => subType.isStringLiteral());
  return stringsOnly
    ? {
        type: "string",
        enum: types.map((subType) => subType.getLiteralValue() as string),
      }
    : {
        anyOf: t.getUnionTypes().map((subType, index) => {
          return convertTypeToJsonSchema(
            subType,
            [...path, index.toString()],
            visitedTypes
          );
        }),
      };
}

function convertIntersectionTypeToJsonSchema(
  t: Type<ts.Type>,
  path: string[],
  visitedTypes: { type: Type<ts.Type>; path: string[] }[]
): JSONSchema6Definition {
  return t.getIntersectionTypes().reduce((acc: JSONSchema6, subType) => {
    const schema = convertTypeToJsonSchema(subType, path, visitedTypes);
    if (typeof schema === "boolean") {
      return acc;
    }

    const required = [...(acc.required ?? []), ...(schema.required ?? [])];

    return {
      ...acc,
      required: required.length > 0 ? required : undefined,
      properties: (acc.properties || schema.properties) && {
        ...acc.properties,
        ...schema.properties,
      },
    };
  }, {});
}

const CONVERTERS: [
  (t: Type<ts.Type>) => boolean,
  (
    t: Type<ts.Type>,
    path: string[],
    visitedTypes: { type: Type<ts.Type>; path: string[] }[]
  ) => JSONSchema6Definition
][] = [
  [(t) => t.isNumber(), convertNumberTypeToJsonSchema],
  [(t) => t.isNumberLiteral(), convertNumberLiteralTypeToJsonSchema],
  [(t) => t.isBoolean(), convertBooleanTypeToJsonSchema],
  [(t) => t.isBooleanLiteral(), convertBooleanLiteralTypeToJsonSchema],
  [(t) => t.isString(), convertStringTypeToJsonSchema],
  [(t) => t.isStringLiteral(), convertStringLiteralTypeToJsonSchema],
  [(t) => t.isArray(), convertArrayTypeToJsonSchema],
  [(t) => t.isTuple(), convertTupleTypeToJsonSchema],
  [(t) => t.isObject(), convertObjectTypeToJsonSchema],
  [(t) => t.isEnum(), convertEnumTypeToJsonSchema],
  [(t) => t.isUnion(), convertUnionTypeToJsonSchema],
  [(t) => t.isIntersection(), convertIntersectionTypeToJsonSchema],
];

/**
 * Convert a typescript type to JSON schema
 * @param type Typescript type
 * @returns JSON schema corresponding to the provided type
 */
export function convertTypeToJsonSchema(
  type: Type<ts.Type>,
  path: string[] = [],
  visitedTypes: { type: Type<ts.Type>; path: string[] }[] = []
): JSONSchema6Definition {
  return (
    CONVERTERS.find(([tester]) => tester(type))?.[1](
      type,
      path,
      visitedTypes
    ) ?? false
  );
}
