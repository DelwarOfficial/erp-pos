# ERP/POS

Multi-tenant retail management for Bangladesh: point of sale, inventory,
purchasing, accounting, service and warranty operations.

Built with Next.js, TypeScript, Prisma, MariaDB and Redis.

## Architecture

```mermaid
flowchart LR
    User[Staff / platform operator] --> UI[Next.js dashboard and POS]
    UI --> API[API routes]
    API --> Auth[Authentication and tenant context]
    Auth --> Domain[Domain commands and services]
    Domain --> DB[(MariaDB via Prisma)]
    Domain --> Queue[(Redis / BullMQ)]
    Worker[Background worker] --> Queue
    Worker --> DB
    Domain --> Providers[External providers and storage]
```

## Workflows

```mermaid
flowchart LR
    Operator[Platform operator] --> Company[Create company and owner]
    Company --> Suspended[Company suspended]
    Suspended --> MFA[Owner enables MFA]
    MFA --> Activate[Operator activates company]
    Activate --> Active[Company active]
```

```mermaid
flowchart LR
    Stock[Receive and manage stock] --> Sale[Create and post sale]
    Sale --> Payment[Record payment]
    Sale --> Inventory[Update inventory]
    Sale --> Ledger[Post accounting entries]
    Payment --> Followup[Returns, refunds and reconciliation]
```

## Documentation

- [Overview, workflows, architecture and local setup](docs/overview.md)
- [Documentation index](docs/README.md)
- [Bengali user guide](docs/user-guide/bn/README.md)
- [Product blueprint](docs/master-plan/ERP_Pos_Blueprint_v4.2.md)

**Author:** [Delwar](https://delwarhossain.net)
