/*
    Every cost-centre pool nets to zero once allocated.

    This is free because of the contra-row convention: pass 2 writes the
    positive share rows and one row at profit centre '-' for the negated pool.
    Sum them and the pool disappears. If it does not, the pool was allocated on
    a different base than it was relieved of.
*/

{{ config(severity='error') }}

select
    company_tla,
    period_month,
    cost_centre_code,
    account_group,
    sum(amount) as residual
from {{ ref('int_alloc_pass2_cc_to_pc') }}
group by 1, 2, 3, 4
having abs(sum(amount)) > 0.01
