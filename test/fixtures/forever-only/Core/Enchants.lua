-- Still present on the Forever client, removed from retail in 12.1.
local hasMain, mainExpiry = GetWeaponEnchantInfo()
local _, bagTexture = GetInventorySlotInfo("Bag0")
local frame = getglobal("UIParent")

-- Gone from Forever as well, so this one is still a finding there.
UIParentLoadAddOn("Blizzard_AuctionUI")

return hasMain, mainExpiry, bagTexture, frame
