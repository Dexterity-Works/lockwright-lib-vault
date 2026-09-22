import { createSelector } from '@reduxjs/toolkit'
import { matchPatternToValue } from 'lockwright-utils-pattern-search'

import { selectRecords } from './selectRecords'

export const selectFolders = (filters) =>
  createSelector(
    selectRecords({
      filters: {
        isFolder: true
      }
    }),
    ({ isLoading, data: records }) => ({
      isLoading,
      data: records?.reduce(
        (acc, record) => {
          const folder = record.folder

          if (filters?.searchPattern) {
            const isMatch = matchPatternToValue(filters.searchPattern, folder)

            if (!isMatch) {
              return acc
            }
          }

          if (record.isFavorite) {
            acc.favorites.records.push(record)
          }

          if (!folder) {
            acc.noFolder.records.push(record)
            return acc
          }

          if (!acc.customFolders[folder]) {
            acc.customFolders[folder] = {
              name: folder,
              records: []
            }
          }

          acc.customFolders[folder].records.push(record)
          return acc
        },
        {
          favorites: { records: [] },
          noFolder: { records: [] },
          customFolders: {}
        }
      )
    })
  )
