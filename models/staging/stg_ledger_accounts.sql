{{ config(materialized='view') }}

/*
    ledger_accounts_l collapsed to one row per account_key.

    18 of 259 PUK accounts share an account_key. Collapsing is not optional —
    joining the raw lookup to the GL fans postings and silently doubles amounts.

    Rule when duplicates disagree on account_group: keep the alphabetically
    first non-null group so the choice is deterministic and reproducible, and
    raise `has_account_group_conflict` so the disagreement is visible rather
    than resolved quietly. The test on that column is a warn, not an error:
    the conflicts are pre-existing data quality, and blocking the build on them
    would just get the test disabled.
*/

with source as (

    select
        upper(trim(account_key))   as account_key,
        trim(account_group)        as account_group,
        trim(account_name)         as account_name,
        coalesce(cost_centre_required, false) as cost_centre_required,
        coalesce(is_pl_account, null) as is_pl_account
    from {{ source('odoo', 'ledger_accounts_l') }}
    where account_key is not null

),

deduplicated as (

    select
        account_key,
        min(account_group)                  as account_group,
        min(account_name)                   as account_name,
        -- if ANY duplicate requires a cost centre, the key requires one
        max(cost_centre_required)           as cost_centre_required,
        max(is_pl_account)                  as is_pl_account,
        count(*)                            as source_row_count,
        count(distinct account_group) > 1   as has_account_group_conflict
    from source
    group by account_key

)

select
    account_key,
    account_group,
    account_name,
    cost_centre_required,
    -- account_group prefix is the P&L discriminator: REV-*, COGS-*, EXP-*
    coalesce(
        is_pl_account,
        split_part(account_group, '-', 1) in ('REV', 'COGS', 'EXP')
    ) as is_pl_account,
    split_part(account_group, '-', 1) as account_group_prefix,
    source_row_count,
    has_account_group_conflict
from deduplicated
