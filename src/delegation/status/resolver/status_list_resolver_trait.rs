use crate::delegation::status::model::bitstring_status_list_entry::BitstringStatusListEntry;
use std::rc::Rc;

/// Resolves the current value associated with a Bitstring Status List entry.
///
/// Implementations may resolve an authenticated off-chain Status List artifact and/or
/// validate it against an external anchor. Missing or unavailable entries must return an error
/// so authorization remains fail-closed.
pub trait StatusListResolver {
    fn is_status_set(&self, entry: &BitstringStatusListEntry) -> Result<bool, String>;

    /// Issuer-aware status resolution used by production/anchored resolvers.
    ///
    /// Simple resolvers can ignore the issuer and inherit this default behavior.
    fn is_status_set_for_issuer(
        &self,
        _issuer_id: &str,
        entry: &BitstringStatusListEntry,
    ) -> Result<bool, String> {
        self.is_status_set(entry)
    }
}

pub type StatusListResolverRef = Rc<dyn StatusListResolver>;
