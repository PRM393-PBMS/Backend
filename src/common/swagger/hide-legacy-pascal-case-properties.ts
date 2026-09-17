import type { OpenAPIObject } from '@nestjs/swagger';

/**
 * PBMS vẫn nhận alias PascalCase để tương thích client cũ, nhưng OpenAPI chỉ
 * công bố contract camelCase hiện tại. Các alias này không bị thay đổi trong
 * DTO, vì ValidationPipe vẫn cần nhận chúng ở runtime.
 */
export function hideLegacyPascalCaseProperties(document: OpenAPIObject): void {
  const schemas = document.components?.schemas;

  if (!schemas) {
    return;
  }

  for (const schema of Object.values(schemas)) {
    if (!('properties' in schema) || !schema.properties) {
      continue;
    }

    for (const propertyName of Object.keys(schema.properties)) {
      if (/^[A-Z]/.test(propertyName)) {
        delete schema.properties[propertyName];
      }
    }

    if ('required' in schema && Array.isArray(schema.required)) {
      schema.required = schema.required.filter(
        (propertyName) => !/^[A-Z]/.test(propertyName),
      );
    }
  }
}
