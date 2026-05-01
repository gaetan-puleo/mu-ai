/**
 * Re-export TypeBox so Pi extensions that import from 'typebox' resolve correctly.
 * Pi extensions typically use: import { Type } from "typebox";
 */
export { type Static, type TSchema, Type } from '@sinclair/typebox';
