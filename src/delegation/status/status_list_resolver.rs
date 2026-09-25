use crate::delegation::status::bitstring_status_list_entry::BitstringStatusListEntry;
use std::rc::Rc;

/// Resolves the current value associated with a Bitstring Status List entry.
///
/// Implementations may read an in-memory store, an HTTP-hosted status list, or an
/// externally anchored status list. Missing or unavailable entries must return an error
/// so authorization remains fail-closed.
pub trait StatusListResolver {
    fn is_status_set(&self, entry: &BitstringStatusListEntry) -> Result<bool, String>;
}

pub type StatusListResolverRef = Rc<dyn StatusListResolver>;
