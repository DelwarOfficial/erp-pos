import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Prisma } from '@prisma/client';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'prisma', 'mariadb', 'migrations', '20260831180500_tenant_fks', 'migration.sql');
const models = new Map(Prisma.dmmf.datamodel.models.map((model) => [model.name, model]));
const direct = new Set(
  Prisma.dmmf.datamodel.models
    .filter((model) => model.fields.some((field) => field.name === 'companyId'))
    .map((model) => model.name),
);

function sqlName(prefix, ...parts) {
  const raw = [prefix, ...parts].join('_').replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
  if (raw.length <= 60) return raw;
  return `${raw.slice(0, 49)}_${crypto.createHash('sha1').update(raw).digest('hex').slice(0, 10)}`;
}

function dbTable(model) {
  return model.dbName ?? model.name;
}

function dbColumn(model, fieldName) {
  const field = model.fields.find((candidate) => candidate.name === fieldName);
  if (!field) throw new Error(`Missing ${model.name}.${fieldName}`);
  return field.dbName ?? field.name;
}

const parents = new Map();
const relations = [];

for (const child of Prisma.dmmf.datamodel.models) {
  if (!direct.has(child.name)) continue;
  for (const relation of child.fields.filter((field) => field.kind === 'object' && field.relationFromFields?.length)) {
    const parent = models.get(relation.type);
    if (!parent || !direct.has(parent.name)) continue;
    if (relation.relationFromFields.length !== 1 || relation.relationToFields?.length !== 1 || relation.relationToFields[0] !== 'id') continue;
    parents.set(parent.name, parent);
    relations.push({ child, parent, relation, sourceField: relation.relationFromFields[0] });
  }
}

const statements = [
  '-- Generated tenant-consistency constraints for MariaDB.',
  '-- Every direct tenant FK is paired with company_id, preventing cross-tenant references.',
  '',
];

for (const parent of parents.values()) {
  const table = dbTable(parent);
  statements.push(
    `ALTER TABLE \`${table}\` ADD UNIQUE INDEX \`${sqlName('uq_tenant', table, 'id')}\` (\`company_id\`, \`id\`);`,
  );
}

statements.push('');

for (const { child, parent, relation, sourceField } of relations) {
  const childTable = dbTable(child);
  const parentTable = dbTable(parent);
  const childColumn = dbColumn(child, sourceField);
  const relationLabel = relation.name || sourceField;
  const indexName = sqlName('idx_tenant_fk', childTable, relationLabel);
  const constraintName = sqlName('fk_tenant', childTable, relationLabel);
  const onDelete = relation.relationOnDelete === 'Cascade' ? 'CASCADE' : 'RESTRICT';
  statements.push(
    `ALTER TABLE \`${childTable}\` ADD INDEX \`${indexName}\` (\`company_id\`, \`${childColumn}\`);`,
    `ALTER TABLE \`${childTable}\` ADD CONSTRAINT \`${constraintName}\` FOREIGN KEY (\`company_id\`, \`${childColumn}\`) REFERENCES \`${parentTable}\` (\`company_id\`, \`id\`) ON DELETE ${onDelete} ON UPDATE RESTRICT;`,
  );
}

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${statements.join('\n')}\n`);
console.log(JSON.stringify({ output, parents: parents.size, relations: relations.length }));
