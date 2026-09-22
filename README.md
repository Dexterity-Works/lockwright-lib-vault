<p align="center">
  <img src="docs/logo.svg" alt="Lockwright" width="128"/>
</p>

# lockwright-lib-vault

Encrypted vault library for Lockwright. React and Redux integration.

Site: [lockwright.dexterity.works](https://lockwright.dexterity.works)

Community fork of PearPass (Apache 2.0). Not affiliated with or endorsed by Tether Data or the Pears project. This GitHub repo stays a fork of `tetherto/pearpass-lib-vault` on purpose. Do not open pull requests against Tether.

Needs a client:

- **pearpass-lib-vault-bare** for React Native
- **pearpass-lib-vault-desktop** for Pear desktop

No client, no vault operations.

## Table of Contents

- [Features](#features)
- [Install](#install)
- [Usage Examples](#usage-examples)
- [Client Implementation Contract](#client-implementation-contract)
- [Dependencies](#dependencies)
- [Related Projects](#related-projects)
- [License](#license)

## Features

- Create, list, and access encrypted vaults
- Master password protection
- Configurable storage paths
- Redux state, React hooks, actions and selectors
- Jest tests with mocked clients

## Install

```bash
pnpm add git+https://github.com/Dexterity-Works/lockwright-lib-vault.git
```

The package name is `lockwright-lib-vault`.

## Usage Examples

### Initializing the Library

```javascript
import { setPearpassVaultClient } from 'lockwright-lib-vault';

// Set up the vault client with your implementation
// Choose one of the client implementations:
import { createPearpassVaultClient } from 'lockwright-lib-vault-bare';
// OR
import { createPearpassVaultClient } from 'lockwright-lib-vault-desktop'

// Initialize the appropriate client
const  vaultClient  = createPearpassVaultClient();

// Set the client for the vault library
setPearpassVaultClient(vaultClient);
```

### Creating a Master Password

```javascript
import { createMasterPassword } from 'lockwright-lib-vault';

// Create a master password to secure all vaults
const encryptionData = await createMasterPassword('your-secure-password');
```

### Using with React Components

```jsx
import React from 'react';
import { useVaults } from 'lockwright-lib-vault';

function VaultManager() {
  const { 
    data: vaults, 
    isLoading, 
    initVaults, 
    refetch 
  } = useVaults({
    onInitialize: (vaults) => console.log('Vaults initialized', vaults),
    onCompleted: (vaults) => console.log('Vaults loaded', vaults)
  });

  // Component implementation...
}
```

### Working with Folders

```jsx
import React from 'react';
import { useCreateFolder, useFolders } from 'lockwright-lib-vault';

function FolderManager() {
  const { data: folders, isLoading } = useFolders({
    variables: { searchPattern: 'personal' }
  });

  const { createFolder, isLoading: isCreatingFolder } = useCreateFolder({
    onCompleted: (payload) => console.log('Folder created:', payload.name),
    onError: (error) => console.error('Error creating folder:', error)
  });

  const handleCreateFolder = () => {
    createFolder('New Personal Folder');
  };

  // Component implementation...
}
```

### Managing Records

```jsx
import React, { useState } from 'react';
import { useCreateRecord, useRecords, useUpdateRecord } from 'lockwright-lib-vault';

function RecordManager({ vaultId }) {
  const [selectedRecord, setSelectedRecord] = useState(null);
  
  const { data: records, isLoading, refetch } = useRecords({
    variables: {
      vaultId,
      filters: {
        type: 'login',
        isFavorite: false
      },
      sort: { field: 'title', direction: 'asc' }
    }
  });

  const { createRecord, isLoading: isCreating } = useCreateRecord({
    onCompleted: () => refetch()
  });

  const { updateRecord, updateFavoriteState } = useUpdateRecord({
    onCompleted: () => refetch()
  });

  const handleCreateRecord = () => {
    createRecord({
      title: 'New Login',
      type: 'login',
      fields: {
        username: 'user@example.com',
        password: 'secure-password',
        url: 'https://example.com'
      }
    });
  };

  const handleToggleFavorite = (recordId, currentState) => {
    updateFavoriteState(recordId, !currentState);
  };

  // Component implementation...
}
```

## Client Implementation Contract

Anything implementing `pearpassVaultClient` must expose the methods and events below. `setPearpassVaultClient(instance, { currentDeviceName? })` registers the instance; `setCurrentDeviceName(name)` updates the device name afterwards (useful when the name is resolved asynchronously, e.g. via `chrome.runtime.getPlatformInfo` in a browser extension).

### Methods

Active vault:
- `activeVaultInit({ id, encryptionKey }) -> Promise<void>`
- `activeVaultClose() -> Promise<void>`
- `activeVaultGet(key) -> Promise<any>`
- `activeVaultAdd(key, data) -> Promise<void>`
- `activeVaultRemove(key) -> Promise<void>`
- `activeVaultList(filterKey?) -> Promise<Array>`
- `activeVaultFind({ gte?, lt?, gt?, lte?, limit?, reverse? }) -> Promise<Array<{ key, value }>>`
- `activeVaultGetWriterKey() -> Promise<string>` (hex)
- `activeVaultCreateInvite() -> Promise<string>` / `activeVaultDeleteInvite() -> Promise<void>`
- `pairActiveVault(inviteCode) -> Promise<{ vaultId, encryptionKey }>`
- `initListener({ vaultId }) -> Promise<void>`

Master vault:
- `vaultsInit({ encryptionKey, hashedPassword? }) -> Promise<void>` / `vaultsClose() -> Promise<void>`
- `vaultsGet(key) -> Promise<any>`
- `vaultsAdd(key, data) -> Promise<void>`
- `vaultsRemove(key) -> Promise<void>` (deletes a single key; not to be confused with `removeVault`)
- `vaultsList(filterKey?) -> Promise<Array>`
- `vaultsFind({ gte?, lt? }) -> Promise<Array<{ key, value }>>`
- `removeVault(vaultId) -> Promise<void>` (closes if active, drops the master entry, wipes the on-disk autobase)

Personal swarm (direct device-to-device transport):
- `personalSwarmInit() -> Promise<{ topic: string }>` (topic is hex)
- `personalSwarmClose() -> Promise<void>`
- `personalSwarmGetTopic() -> Promise<string | null>`
- `personalSwarmSend(targetTopicHex, envelopeHex) -> Promise<{ ok: true } | { ok: false, reason: string }>`. Fire-and-forget. `ok: true` means queued locally, not delivered to the peer.

Signing (envelope auth - device-scoped identity keypair, independent of the autobase writer keypair):
- `signMessage(messageHex) -> Promise<string>` (hex signature)
- `verifySignature(messageHex, signatureHex, publicKeyHex) -> Promise<boolean>`

Master password & encryption: `vaultsGetStatus`, `recordFailedMasterPassword`, `resetFailedAttempts`, `getMasterPasswordStatus`, `createMasterPassword`, `initWithPassword`, `updateMasterPassword`, `initWithCredentials`, `encryptionInit/Close/Get/Add/GetStatus`, `hashPassword`, `encryptVaultKeyWithHashedPassword`, `encryptVaultWithKey`, `getDecryptionKey`, `decryptVaultKey`, `encryptExportData`, `decryptExportData`, `decryptBitwardenExport`. (See `src/pearpassVaultClient/index.js` for full signatures.)

EventEmitter surface (Node `events` convention):
- `on(event, handler)`, `off(event, handler)`, `emit(event, payload)`, `listenerCount(event) -> number`

### Events

- `'update'` - active vault changed.
- `'master-update'` - master vault changed (other process). Triggers `runActionScan` automatically.
- `'personal-swarm-envelope'` payload `{ envelope: string }` (hex of the wrapper). The lib decodes/verifies envelopes and routes them to `ACTIONS` handlers via the inbox.
- `'personal-swarm-error'` payload `{ reason, message }` - the personal swarm failed to init (e.g. on resume). The device is effectively offline for direct delivery until reinitialised.
- `'vault-access-revoked'` payload `{ vaultId, actor }` - emitted by the lib for consumer apps to run their local delete via `useVault().deleteVaultLocal`.
- `'newListener'` (Node EventEmitter convention) - the lib uses this to re-drain the inbox when a `'vault-access-revoked'` listener attaches after boot.

### Device-local keyspaces

`actions/inbox/`, `actions/outbox/`, `actions/inbox-quarantine/`, `actions/seen/`, and `peer/` keys in the master vault are strictly device-local. They are not replicated to peers - the personal-swarm transport carries inbox messages, not autobase writes.

## Dependencies

### Peer Dependencies
- [react](https://reactjs.org/)
- [react-redux](https://react-redux.js.org/)
- [redux-toolkit](https://redux-toolkit.js.org/)

## Related Projects

- [lockwright-app-mobile](https://github.com/Dexterity-Works/lockwright-app-mobile)
- [lockwright-app-desktop](https://github.com/Dexterity-Works/lockwright-app-desktop)
- [lockwright-app-browser-extension](https://github.com/Dexterity-Works/lockwright-app-browser-extension)
- [lockwright-lib-vault-core](https://github.com/Dexterity-Works/lockwright-lib-vault-core)
- [lockwright-lib-constants](https://github.com/Dexterity-Works/lockwright-lib-constants)

## Contributing

Open issues and pull requests on this repo (`Thaoh/lockwright-lib-vault`). Do not open PRs against `tetherto/pearpass-lib-vault`. See [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## License

Apache License 2.0. See `LICENSE.md` and `NOTICE.md`.
