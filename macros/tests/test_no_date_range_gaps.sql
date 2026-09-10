{% test no_date_range_gaps(model, partition_by, valid_from='valid_from', valid_to='valid_to') %}

{#-
    Within a key, each range must start exactly where the previous one ended.
    A gap is a month with no rate at all, which lands the whole pool on the
    coverage-gap path without anyone noticing.
-#}

with ranges as (

    select distinct
        {{ partition_by | join(',\n        ') }},
        {{ valid_from }} as valid_from,
        {{ valid_to }}   as valid_to
    from {{ model }}

),

sequenced as (

    select
        *,
        lag(valid_to) over (
            partition by {{ partition_by | join(', ') }}
            order by valid_from
        ) as previous_valid_to
    from ranges

)

select *
from sequenced
where previous_valid_to is not null
  and previous_valid_to <> valid_from

{% endtest %}
