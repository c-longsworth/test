{% test shares_sum_to_one(model, share_column, partition_by, tolerance=0.0001) %}

{#-
    Shares must sum to exactly 1 within each (company, key, date range). A key
    summing to 0.98 does not fail anywhere — it quietly loses 2% of a pool, and
    the GL tie-out still passes because the contra row is derived from what was
    actually allocated. This test is the only thing that catches it.
-#}

with grouped as (

    select
        {{ partition_by | join(',\n        ') }},
        sum({{ share_column }}) as total_share
    from {{ model }}
    group by {{ range(1, partition_by | length + 1) | join(', ') }}

)

select *
from grouped
where abs(total_share - 1) > {{ tolerance }}

{% endtest %}
