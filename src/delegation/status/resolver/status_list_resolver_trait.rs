use crate::delegation::status::model::bitstring_status_list_entry::BitstringStatusListEntry;
use std::rc::Rc;

/// Resolves the current value associated with a Bitstring Status List entry for
/// the issuer that created the credential.
///
/// Implementations may authenticate off-chain artifacts and/or validate them
/// against external anchors. Missing or unavailable entries must return an error
/// so authorization remains fail-closed.
pub trait StatusListResolver {
    fn is_status_set(
        &self,
        issuer_id: &str,
        entry: &BitstringStatusListEntry,
    ) -> Result<bool, String>;
}

pub type StatusListResolverRef = Rc<dyn StatusListResolver>;
