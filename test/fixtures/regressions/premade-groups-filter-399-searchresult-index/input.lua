-- Shape reconstructed from 0xbs/premade-groups-filter#399 (ItalistAddons, 2026-08-23):
--   "...Blizzard_GroupFinder/Mainline/LFGList.lua:3362: attempt to index field 'activityIDs'
--    (a secret table value, while execution tainted by 'PremadeGroupsFilter')"
-- C_LFGList.GetSearchResultInfo is documented SecretInChatMessagingLockdown, and
-- LfgSearchResultData.activityIDs carries no NeverSecret marker, so indexing it can raise.
local PGF = {}

function PGF:GetSearchResultInfo(searchResultID)
	local searchResultInfo = C_LFGList.GetSearchResultInfo(searchResultID)
	if not searchResultInfo then
		return nil
	end
	-- numMembers is marked NeverSecret in the generated docs, so this line is fine.
	self.members = searchResultInfo.numMembers
	self.activityID = searchResultInfo.activityIDs[1]
	return searchResultInfo
end

return PGF
