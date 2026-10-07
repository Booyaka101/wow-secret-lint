-- Still present on the Forever client, removed from retail in 12.1: bare and dotted alike.
local hasMain, mainExpiry = GetWeaponEnchantInfo()
local _, bagTexture = GetInventorySlotInfo("Bag0")
local frame = getglobal("UIParent")
local dye = C_DyeColor.GetDyeColorForItem(1)

-- Gone from Forever as well, so this one is still a finding there.
UIParentLoadAddOn("Blizzard_AuctionUI")

return hasMain, mainExpiry, bagTexture, frame, dye
