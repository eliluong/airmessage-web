/* eslint-env node */
const {pathsToModuleNameMapper} = require("ts-jest");
const {compilerOptions} = require("./tsconfig.json");

const pathModuleNameMapper = pathsToModuleNameMapper(compilerOptions.paths ?? {}, {prefix: "<rootDir>/"});

/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  moduleNameMapper: {
    '\\.(wav|mp3|ogg)$': '<rootDir>/test/__mocks__/fileMock.js',
    ...pathModuleNameMapper,
  },
};