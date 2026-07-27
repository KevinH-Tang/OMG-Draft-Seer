import { memo } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { useTranslation } from 'react-i18next'
import { slotLabel } from '../core/layout'
import { cn } from '../lib/cn'
import type { Ability, RecognizedSlot } from '../types'
import { SkillIcon } from './SkillIcon'

const MANUAL_POOL_ITEM_SIZE =
  'size-[50px] items-center justify-center [&_.skill-icon]:size-12 [&_.skill-icon]:flex-[0_0_48px]'

const ManualAbilitySlot = memo(function ManualAbilitySlot({
  slot,
  abilities,
  isOpen,
  onOpenChange,
  onSelect,
}: {
  slot: RecognizedSlot
  abilities: ReadonlyMap<number, Ability>
  isOpen: boolean
  onOpenChange: (slotIndex: number, open: boolean) => void
  onSelect: (slotIndex: number, abilityId: number) => void
}) {
  const { t } = useTranslation()
  const best = slot.candidates[0]
  const bestAbility =
    best === undefined ? undefined : abilities.get(best.abilityId)
  const selectedAbility =
    slot.selectedAbilityId === undefined
      ? undefined
      : abilities.get(slot.selectedAbilityId)
  const displayedAbility = selectedAbility ?? bestAbility
  const confirmed = slot.selectedAbilityId !== undefined
  const slotName = displayedAbility?.name ?? t('common.unknownAbility')

  return (
    <Popover.Root
      open={isOpen}
      onOpenChange={(open) => onOpenChange(slot.index, open)}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            'relative inline-flex shrink-0 overflow-visible rounded-sm border border-border bg-canvas text-inherit shadow-[inset_0_0_0_1px_rgb(255_255_255_/_0.05)] transition-[border-color,filter] hover:border-accent hover:brightness-125 focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&_.skill-icon]:shrink-0 [&_.skill-icon]:overflow-hidden [&_.skill-icon]:rounded-sm',
            MANUAL_POOL_ITEM_SIZE,
            confirmed &&
              'border-positive shadow-[inset_0_0_0_1px_rgb(74_222_128_/_0.4)]',
          )}
          title={`${slotLabel(slot.index)} · ${slotName} · ${confirmed ? t('common.confirmed') : t('common.suggestion')}`}
          aria-label={`${slotLabel(slot.index)}，${slotName}，${confirmed ? t('common.confirmed') : t('common.suggestion')}，${t('analysis.selectCandidate')}`}
        >
          <SkillIcon
            abilityId={displayedAbility?.id}
            shortName={displayedAbility?.shortName}
            name={displayedAbility?.name}
            isHero={displayedAbility?.isHero}
          />
          <span className="absolute -top-2 -left-1 z-2 grid h-[13px] min-w-[17px] place-items-center rounded-full border border-border-strong bg-canvas px-0.5 font-mono text-[7px] leading-none text-text-muted">
            {slotLabel(slot.index)}
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="z-[80] grid w-[max(300px,var(--radix-popover-trigger-width))] max-w-[calc(100vw-16px)] max-h-[min(380px,var(--radix-popper-available-height))] gap-1 overflow-y-auto rounded-sm border border-border bg-surface p-1 shadow-panel"
          side="bottom"
          align="start"
          sideOffset={5}
          collisionPadding={8}
        >
          {slot.candidates.map((candidate, index) => {
            const item = abilities.get(candidate.abilityId)
            if (!item) return null
            return (
              <button
                type="button"
                className="flex min-w-0 items-center gap-2 border border-border bg-surface-raised px-1.5 py-1 text-left text-xs text-text transition-colors hover:border-accent hover:bg-accent-soft focus-visible:border-accent focus-visible:bg-accent-soft focus-visible:outline-hidden"
                key={candidate.abilityId}
                onClick={() => onSelect(slot.index, candidate.abilityId)}
              >
                <span className="w-4 shrink-0 text-center font-mono text-[11px] text-text-muted">
                  {index + 1}
                </span>
                <SkillIcon
                  abilityId={item.id}
                  shortName={item.shortName}
                  name={item.name}
                  isHero={item.isHero}
                />
                <span className="min-w-0 truncate">{item.name}</span>
              </button>
            )
          })}
          {slot.candidates.length === 0 && (
            <span className="p-2 text-xs text-text-muted">
              {t('common.noCandidates')}
            </span>
          )}
          <Popover.Arrow className="fill-surface" width={12} height={6} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
})

const ManualAbilityPoolSection = memo(function ManualAbilityPoolSection({
  id,
  labelKey,
  slots,
  columns,
  className,
  abilities,
  manualSlotIndex,
  onOpenChange,
  onSelect,
}: {
  id: string
  labelKey: 'common.ultimates' | 'common.abilities' | 'common.heroes'
  slots: readonly RecognizedSlot[]
  columns: 1 | 6
  className?: string
  abilities: ReadonlyMap<number, Ability>
  manualSlotIndex?: number
  onOpenChange: (slotIndex: number, open: boolean) => void
  onSelect: (slotIndex: number, abilityId: number) => void
}) {
  const { t } = useTranslation()

  return (
    <section
      className={cn(
        'min-w-0 rounded-sm border border-border bg-surface-raised p-2',
        className,
      )}
      aria-labelledby={id}
    >
      <header className="mb-2 font-mono text-[10px] font-bold text-text">
        <span id={id}>{t(labelKey)}</span>
      </header>
      <div
        className={cn(
          'grid justify-center gap-1',
          columns === 6 ? 'grid-cols-[repeat(6,50px)]' : 'grid-cols-[50px]',
        )}
      >
        {slots.map((slot) => (
          <ManualAbilitySlot
            key={slot.index}
            slot={slot}
            abilities={abilities}
            isOpen={manualSlotIndex === slot.index}
            onOpenChange={onOpenChange}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  )
})

export const ManualAbilityPool = memo(function ManualAbilityPool({
  slots,
  abilities,
  manualSlotIndex,
  onOpenChange,
  onSelect,
}: {
  slots: readonly RecognizedSlot[]
  abilities: ReadonlyMap<number, Ability>
  manualSlotIndex?: number
  onOpenChange: (slotIndex: number, open: boolean) => void
  onSelect: (slotIndex: number, abilityId: number) => void
}) {
  const { t } = useTranslation()
  const heroes = slots.filter((slot) => slot.category === 'hero')
  const abilitySlots = slots.filter((slot) => slot.category === 'ability')
  const ultimates = slots.filter((slot) => slot.category === 'ultimate')
  // Hero slots alternate left/right in the source screenshot layout.
  const leftHeroes = heroes.filter((_, index) => index % 2 === 0)
  const rightHeroes = heroes.filter((_, index) => index % 2 === 1)

  return (
    <div
      className="mx-auto mt-[20px] grid w-[490px] max-w-full grid-cols-[68px_338px_68px] items-start justify-center gap-2 max-[549px]:w-[338px] max-[549px]:grid-cols-1"
      aria-label={t('analysis.manualValidation')}
    >
      <ManualAbilityPoolSection
        id="manual-pool-ultimate"
        labelKey="common.ultimates"
        slots={ultimates}
        columns={6}
        className="col-start-2 w-[338px] max-[549px]:col-start-auto"
        abilities={abilities}
        manualSlotIndex={manualSlotIndex}
        onOpenChange={onOpenChange}
        onSelect={onSelect}
      />
      <ManualAbilityPoolSection
        id="manual-pool-hero-left"
        labelKey="common.heroes"
        slots={leftHeroes}
        columns={1}
        className="col-start-1 row-start-2 w-[68px] max-[549px]:col-start-auto max-[549px]:row-start-auto"
        abilities={abilities}
        manualSlotIndex={manualSlotIndex}
        onOpenChange={onOpenChange}
        onSelect={onSelect}
      />
      <ManualAbilityPoolSection
        id="manual-pool-ability"
        labelKey="common.abilities"
        slots={abilitySlots}
        columns={6}
        className="col-start-2 row-start-2 w-[338px] max-[549px]:col-start-auto max-[549px]:row-start-auto"
        abilities={abilities}
        manualSlotIndex={manualSlotIndex}
        onOpenChange={onOpenChange}
        onSelect={onSelect}
      />
      <ManualAbilityPoolSection
        id="manual-pool-hero-right"
        labelKey="common.heroes"
        slots={rightHeroes}
        columns={1}
        className="col-start-3 row-start-2 w-[68px] max-[549px]:col-start-auto max-[549px]:row-start-auto"
        abilities={abilities}
        manualSlotIndex={manualSlotIndex}
        onOpenChange={onOpenChange}
        onSelect={onSelect}
      />
    </div>
  )
})
