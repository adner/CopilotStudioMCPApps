import type { Context, FC } from "react";

/** CopilotKit's OpenGenerativeUIContentSchema. */
export interface OpenGenerativeUIContent {
  initialHeight?: number;
  generating?: boolean;
  css?: string;
  cssComplete?: boolean;
  html?: string[];
  htmlComplete?: boolean;
  jsFunctions?: string;
  jsFunctionsComplete?: boolean;
  jsExpressions?: string[];
  jsExpressionsComplete?: boolean;
}

/** A host function exposed to generated code as Websandbox.connection.remote.<name>(...). */
export interface SandboxFunction {
  name: string;
  handler: (...args: unknown[]) => unknown;
}

export const OpenGenerativeUIActivityRenderer: FC<{ content: OpenGenerativeUIContent }>;
export const OpenGenerativeUIActivityType: string;
export const SandboxFunctionsContext: Context<SandboxFunction[]>;
export function processPartialHtml(html: string): string;
