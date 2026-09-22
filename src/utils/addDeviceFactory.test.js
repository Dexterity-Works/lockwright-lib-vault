import { generateUniqueId } from 'lockwright-utils-generate-unique-id'

import { addDeviceFactory } from './addDeviceFactory'
import { validateAndPrepareDevice } from './validateAndPrepareDevice'

jest.mock('lockwright-utils-generate-unique-id', () => ({
  generateUniqueId: jest.fn()
}))

jest.mock('./validateAndPrepareDevice', () => ({
  validateAndPrepareDevice: jest.fn()
}))

describe('addDeviceFactory', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(Date, 'now').mockReturnValue(1749848117883)
  })

  it('should add a device with correct fields and call dependencies', () => {
    const mockId = '123-abc'
    const payload = 'ios'
    const vaultId = 'vault-456'
    const writerKey = 'wk-test'

    generateUniqueId.mockReturnValue(mockId)
    validateAndPrepareDevice.mockImplementation((device) => device)

    const result = addDeviceFactory(payload, vaultId, writerKey)

    expect(generateUniqueId).toHaveBeenCalled()
    expect(validateAndPrepareDevice).toHaveBeenCalledWith(
      expect.objectContaining({
        id: mockId,
        vaultId,
        name: 'ios',
        writerKey,
        createdAt: 1749848117883,
        recordSchema: 2
      })
    )

    expect(result.id).toBe(mockId)
    expect(result.vaultId).toBe(vaultId)
    expect(result.createdAt).toBe(1749848117883)
  })
})
