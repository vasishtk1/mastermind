/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as audioValidators from "../audioValidators.js";
import type * as benchmarks from "../benchmarks.js";
import type * as clinicalPipeline from "../clinicalPipeline.js";
import type * as compare from "../compare.js";
import type * as directives from "../directives.js";
import type * as emberIncidents from "../emberIncidents.js";
import type * as evals from "../evals.js";
import type * as journals from "../journals.js";
import type * as mastermindIncidents from "../mastermindIncidents.js";
import type * as patients from "../patients.js";
import type * as remediation from "../remediation.js";
import type * as telemetry from "../telemetry.js";
import type * as validation from "../validation.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  audioValidators: typeof audioValidators;
  benchmarks: typeof benchmarks;
  clinicalPipeline: typeof clinicalPipeline;
  compare: typeof compare;
  directives: typeof directives;
  emberIncidents: typeof emberIncidents;
  evals: typeof evals;
  journals: typeof journals;
  mastermindIncidents: typeof mastermindIncidents;
  patients: typeof patients;
  remediation: typeof remediation;
  telemetry: typeof telemetry;
  validation: typeof validation;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
