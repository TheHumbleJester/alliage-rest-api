import { parse } from "comment-parser";
import path from "path";
import {
  ts,
  ClassDeclaration,
  LanguageService,
  Node,
  Decorator,
  SourceFile,
  SyntaxKind,
  MethodDeclaration,
  Project,
} from "ts-morph";
import { convertTypeToJsonSchema } from "../utils/json-schema";

export class MetadataManager {
  constructor(
    private env: string,
    private sources: string[],
    private metadataPath: string,
    private disableAutomaticGenerationOnDev: boolean
  ) {}

  async loadMetadata() {
    /**
     * To avoid the developer having to do it manually while developping
     * we trigger the generation of the metadata before loading them
     */
    if (this.env === "development" && !this.disableAutomaticGenerationOnDev) {
      this.generateMetadata();
    }
  }

  generateMetadata() {
    const project = new Project({
      tsConfigFilePath: path.resolve("./tsconfig.json"),
    });

    const files = project.getSourceFiles(this.sources);
    const metadata = files.map((file) => getControllerMetadata(file));
    
  }

  readMetadata(_method: string, _path: string) {}
}

function getRootClass(
  cd: ClassDeclaration,
  languageService: LanguageService
): ClassDeclaration {
  // Get the "extends" expression
  const ce = cd.getExtends();
  if (!ce) {
    return cd;
  }

  // Get the symbol and the definition of that "extends" expression
  const defs = languageService.getDefinitions(ce);
  const ceSymbol = ce.getType().getSymbol();
  if (defs.length === 0 || !ceSymbol) {
    return cd;
  }

  // Find the class declaration corresponding to that symbol
  const parentClass = defs[0].getSourceFile().getClass(ceSymbol.getName());
  if (!parentClass) {
    return cd;
  }

  return getRootClass(parentClass, languageService);
}

const ABSTRACT_CONTROLLER_NAME = "AbstractController";
const ABSTRACT_CONTROLLER_PATH_REGEXP =
  /\/node_modules\/alliage-webserver\/controller\/index\.d\.ts$/;

function isAbstractController(classDecl: ClassDeclaration) {
  return (
    classDecl.getName() === ABSTRACT_CONTROLLER_NAME &&
    ABSTRACT_CONTROLLER_PATH_REGEXP.test(
      classDecl.getSourceFile().getFilePath()
    )
  );
}

const ABSTRACT_REQUEST_NAME = "AbstractRequest";
const ABSTRACT_REQUEST_PATH_REGEXP =
  /\/node_modules\/alliage-webserver\/http\/request\.d\.ts$/;

function isAbstractRequest(node: Node<ts.Node>) {
  const symbol = node.getType().getSymbol();
  return symbol?.getDeclarations().some((decl) => {
    const classDecl = decl.asKind(ts.SyntaxKind.ClassDeclaration);
    return (
      classDecl &&
      classDecl.getName() === ABSTRACT_REQUEST_NAME &&
      ABSTRACT_REQUEST_PATH_REGEXP.test(classDecl.getSourceFile().getFilePath())
    );
  });
}

const DECORATORS_PATH_REGEXP =
  /\/node_modules\/alliage-webserver\/controller\/decorations\.d\.ts$/;
const ALLOWED_DECORATORS_ARGUMENT_KINDS = [
  SyntaxKind.StringLiteral,
  SyntaxKind.NoSubstitutionTemplateLiteral,
];

function getActionDecoratorMetadata(decorator: Decorator) {
  const callExpression = decorator.getCallExpression();
  if (!callExpression) {
    return undefined;
  }

  const originalDef = callExpression
    .getExpression()
    .asKind(ts.SyntaxKind.Identifier)
    ?.getDefinitions()
    .find((def) => {
      return DECORATORS_PATH_REGEXP.test(def.getSourceFile().getFilePath());
    });

  const path = callExpression.getArguments()[0];

  return (
    originalDef &&
    path &&
    // We check if the first argument is a non-dynamic string
    ALLOWED_DECORATORS_ARGUMENT_KINDS.includes(path.getKind()) && {
      // We get the original name of the decorator
      method: originalDef.getName().toLowerCase(),
      path: eval(path.getText()),
    }
  );
}

const HTTP_ERROR_NAME = "HttpError";
const HTTP_ERROR_PATH_REGEXP =
  /\/node_modules\/alliage-rest-api\/error\/index\.d\.ts$/;
function getActionErrorsMetadata(
  methodDecl: MethodDeclaration,
  languageService: LanguageService
) {
  return methodDecl
    .getBody()
    ?.getDescendantsOfKind(ts.SyntaxKind.ThrowStatement)
    .flatMap((throwStatement) => {
      const comments = throwStatement.getLeadingCommentRanges();
      const doc =
        comments.length > 0
          ? parse(comments[comments.length - 1].getText())
          : undefined;
      const symbol = throwStatement.getExpression().getType().getSymbol();
      if (!symbol) {
        return [];
      }
      return symbol.getDeclarations().flatMap((d) => {
        const cd = d.asKind(ts.SyntaxKind.ClassDeclaration);
        if (!cd) {
          // Is not a class
          return [];
        }

        const rcd = getRootClass(cd, languageService);
        if (
          rcd.getName() !== HTTP_ERROR_NAME ||
          !HTTP_ERROR_PATH_REGEXP.test(rcd.getSourceFile().getFilePath())
        ) {
          // Is not an HttpError
          return [];
        }

        // We get the type provided to the generic class HttpError
        const [codeType, payloadType] = throwStatement
          .getExpression()
          .getType()
          .getTypeArguments();

        return [
          {
            description: doc
              ?.flatMap(({ description }) => (description ? [description] : []))
              .join("\n"),
            code: codeType.getLiteralValue(),
            payloadType,
          },
        ];
      });
    });
}

function getActionDefaultStatusCode(methodDecl: MethodDeclaration) {
  const tags = methodDecl.getSymbol()?.getJsDocTags();
  const scTag = tags?.find((t) => t.getName() === "defaultStatusCode");

  let statusCode = 200;
  if (scTag) {
    const code = parseInt(
      scTag
        .getText()
        .map((t) => t.text)
        .join(""),
      10
    );
    statusCode = !isNaN(code) ? code : 200;
  }
  return statusCode;
}

function getActionValidateInputFlag(methodDecl: MethodDeclaration) {
  const tags = methodDecl.getSymbol()?.getJsDocTags();
  const viTag = tags?.find((t) => t.getName() === "validateInput");

  return viTag
    ?.getText()
    .map((t) => t.text)
    .join("") === "false"
    ? false
    : true;
}

function getActionValidateOutputFlag(methodDecl: MethodDeclaration) {
  const tags = methodDecl.getSymbol()?.getJsDocTags();
  const viTag = tags?.find((t) => t.getName() === "validateOutput");

  return viTag
    ?.getText()
    .map((t) => t.text)
    .join("") === "true"
    ? true
    : false;
}

export function getControllerMetadata(file: SourceFile) {
  const languageService = file.getProject().getLanguageService();

  // Checks if we have a default export
  const classDecl = file
    .getDefaultExportSymbol()
    ?.getValueDeclaration()
    ?.asKind(ts.SyntaxKind.ClassDeclaration);

  if (!classDecl) {
    return undefined;
  }

  // Gets the root parent class
  const rootParentClass = getRootClass(classDecl, languageService);

  // Checks if the classDecl extends the AbstractController
  if (rootParentClass === classDecl || !isAbstractController(rootParentClass)) {
    return undefined;
  }

  // Gets all the controller's actions with their routes
  const actions = classDecl.getMethods().flatMap((methodDecl) => {
    const params = methodDecl.getParameters();
    // If its first argument is not an AbstractRequest
    if (params.length === 0 || !isAbstractRequest(params[0])) {
      return [];
    }

    const routes = methodDecl.getDecorators().flatMap((decorator) => {
      const data = getActionDecoratorMetadata(decorator);
      return data ? [data] : [];
    });

    // If no route is assigned to the controller
    if (routes.length === 0) {
      return [];
    }

    const [paramsType, queryType, bodyType] = params[0]
      .getType()
      .getTypeArguments();

    const returnType = methodDecl.getReturnType();
    // If it doesn't return a promise
    if (returnType.getSymbol()?.getName() !== "Promise") {
      return [];
    }

    const errors = getActionErrorsMetadata(methodDecl, languageService) ?? [];

    const defaultStatusCode = getActionDefaultStatusCode(methodDecl);
    const validateInput = getActionValidateInputFlag(methodDecl);
    const validateOutput = getActionValidateOutputFlag(methodDecl);

    return [
      {
        name: methodDecl.getName(),
        defaultStatusCode,
        validateInput,
        validateOutput,
        routes,
        paramsType: convertTypeToJsonSchema(paramsType),
        queryType: convertTypeToJsonSchema(queryType),
        bodyType: convertTypeToJsonSchema(bodyType),
        returnType: convertTypeToJsonSchema(
          methodDecl.getReturnType().getTypeArguments()[0]
        ),
        errors: errors.map(({ payloadType, ...e }) => ({
          ...e,
          payloadType: convertTypeToJsonSchema(payloadType),
        })),
      },
    ];
  });

  return {
    name: classDecl.getName(),
    actions,
  };
}
