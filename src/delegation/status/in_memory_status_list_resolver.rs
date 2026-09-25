use crate::delegation::status::bitstring_status_list_entry::BitstringStatusListEntry;
use crate::delegation::status::status_list_resolver::StatusListResolver;
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct StatusEntryKey {
    status_list_credential: String,
    status_purpose: String,
    status_list_index: String,
}

impl StatusEntryKey {
    fn from_entry(entry: &BitstringStatusListEntry) -> Self {
        Self {
            status_list_credential: entry.status_list_credential().clone(),
            status_purpose: entry.status_purpose().as_str().to_string(),
            status_list_index: entry.status_list_index().clone(),
        }
    }
}

/// In-memory Bitstring Status List resolver used before introducing the external
/// status-list and blockchain-backed implementations.
#[derive(Clone, Default)]
pub struct InMemoryStatusListResolver {
    values: Rc<RefCell<HashMap<StatusEntryKey, bool>>>,
}

impl InMemoryStatusListResolver {
    pub fn new() -> Self {
        Self::default()
    }

    /// Registers or updates the bit associated with an entry.
    ///
    /// false means the status bit is clear; true means it is set.
    pub fn set_status(&self, entry: &BitstringStatusListEntry, is_set: bool) {
        self.values
            .borrow_mut()
            .insert(StatusEntryKey::from_entry(entry), is_set);
    }
}

impl StatusListResolver for InMemoryStatusListResolver {
    fn is_status_set(&self, entry: &BitstringStatusListEntry) -> Result<bool, String> {
        self.values
            .borrow()
            .get(&StatusEntryKey::from_entry(entry))
            .copied()
            .ok_or_else(|| {
                format!(
                    "Status entry {}:{} ({}) is not available",
                    entry.status_list_credential(),
                    entry.status_list_index(),
                    entry.status_purpose()
                )
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(index: &str) -> BitstringStatusListEntry {
        BitstringStatusListEntry::revocation(
            None,
            index.to_string(),
            String::from("https://status.example/lists/revocation-1"),
        )
        .expect("test status entry must be valid")
    }

    #[test]
    fn resolves_registered_status_values() -> Result<(), String> {
        let resolver = InMemoryStatusListResolver::new();
        let status = entry("42");

        resolver.set_status(&status, false);
        assert!(!resolver.is_status_set(&status)?);

        resolver.set_status(&status, true);
        assert!(resolver.is_status_set(&status)?);
        Ok(())
    }

    #[test]
    fn unknown_status_entry_fails_closed() {
        let resolver = InMemoryStatusListResolver::new();
        assert!(resolver.is_status_set(&entry("42")).is_err());
    }
}
