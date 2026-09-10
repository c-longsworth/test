{{ config(materialized='table') }}

/*
    Single source of truth. Everything the MC report shows is a filter over this
    model, and this model ties to the ledger.

    Four layers, unioned:

      gl              every P&L posting once, at its cost centre. Directly
                      attributable postings carry a real profit centre; pooled
                      and variable-key postings sit at '-' until their
                      allocation layer moves them.
      alloc_cc_to_cc  pass 1 movements between cost centres. Sums to zero.
      alloc_cc_to_pc  pass 2, cost-centre pools emptied to profit centres,
                      with the contra row. Sums to zero per pool.
      alloc_var_key   variable cost keys, with the contra row. Sums to zero.

    Because the three allocation layers each net to zero, the total of this
    model equals the total of the GL, by company and month, for source systems
    'odoo' and 'import'. That is asserted, not assumed:
    tests/assert_profit_centre_postings_tie_to_gl.sql.

    Reading it: for profit-centre reporting, exclude profit_centre_code = '-'.
    Those rows exist to make the arithmetic close, not to be reported.
*/

with gl_layer as (

    select
        'gl'                              as layer,
        source_system,
        company_tla,
        period_month,
        account_group,
        account_group_prefix,
        account_key,
        cost_centre_code,
        resolved_profit_centre_code       as profit_centre_code,
        allocation_route,
        cast(null as varchar)             as allocation_key,
        amount,
        is_management_adjustment,
        is_unallocated,
        cost_centre_required,
        management_reporting_comment,
        gl_line_id                        as source_row_id,
        false                             as is_key_coverage_gap
    from {{ ref('int_gl_pl_postings') }}

),

cc_to_cc_layer as (

    select
        'alloc_cc_to_cc'          as layer,
        source_system,
        company_tla,
        period_month,
        account_group,
        split_part(account_group, '-', 1) as account_group_prefix,
        cast(null as varchar)     as account_key,
        cost_centre_code,
        '-'                       as profit_centre_code,
        'cost_centre_pool'        as allocation_route,
        cast(null as varchar)     as allocation_key,
        amount,
        source_system = 'manual_adjustment' as is_management_adjustment,
        false                     as is_unallocated,
        false                     as cost_centre_required,
        cast(null as varchar)     as management_reporting_comment,
        source_cost_centre_code   as source_row_id,
        false                     as is_key_coverage_gap
    from {{ ref('int_alloc_pass1_cc_to_cc') }}

),

cc_to_pc_layer as (

    select
        'alloc_cc_to_pc'          as layer,
        source_system,
        company_tla,
        period_month,
        account_group,
        split_part(account_group, '-', 1) as account_group_prefix,
        cast(null as varchar)     as account_key,
        cost_centre_code,
        profit_centre_code,
        'cost_centre_pool'        as allocation_route,
        allocation_key,
        amount,
        source_system = 'manual_adjustment' as is_management_adjustment,
        profit_centre_code = '{{ var("unallocated_code") }}' as is_unallocated,
        false                     as cost_centre_required,
        cast(null as varchar)     as management_reporting_comment,
        cost_centre_code          as source_row_id,
        is_key_coverage_gap
    from {{ ref('int_alloc_pass2_cc_to_pc') }}

),

variable_key_layer as (

    select
        'alloc_var_key'           as layer,
        source_system,
        company_tla,
        period_month,
        account_group,
        split_part(account_group, '-', 1) as account_group_prefix,
        cast(null as varchar)     as account_key,
        cost_centre_code,
        profit_centre_code,
        'variable_key'            as allocation_route,
        account_group             as allocation_key,
        amount,
        source_system = 'manual_adjustment' as is_management_adjustment,
        profit_centre_code = '{{ var("unallocated_code") }}' as is_unallocated,
        false                     as cost_centre_required,
        cast(null as varchar)     as management_reporting_comment,
        account_group             as source_row_id,
        is_key_coverage_gap
    from {{ ref('int_alloc_variable_cost_keys') }}

)

select * from gl_layer
union all
select * from cc_to_cc_layer
union all
select * from cc_to_pc_layer
union all
select * from variable_key_layer
